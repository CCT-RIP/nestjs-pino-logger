import { CaptureStream } from './helpers/capture-stream';
import { Injectable, Module } from '@nestjs/common';
import { Logger } from '../src/logger';
import { LoggerModule } from '../src/logger.module';
import { Params, PARAMS_PROVIDER_TOKEN } from '../src/params';
import { __resetRootLoggerForTests, PinoLogger } from '../src/pino-logger';
import { Test } from '@nestjs/testing';

@Injectable()
class StreamHolder {
  constructor(readonly stream: CaptureStream) {}
}

@Module({
  providers: [
    {
      provide: StreamHolder,
      useFactory: () => new StreamHolder(new CaptureStream()),
    },
  ],
  exports: [StreamHolder],
})
class StreamModule {}

describe('LoggerModule', () => {
  let stream: CaptureStream;

  beforeEach(() => {
    __resetRootLoggerForTests();
    stream = new CaptureStream();
  });

  describe('forRoot', () => {
    it('отдаёт Logger, PinoLogger и параметры через DI', async () => {
      const params: Params = { pinoHttp: [{ level: 'trace' }, stream] };

      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule.forRoot(params)],
      }).compile();

      expect(moduleRef.get(Logger)).toBeInstanceOf(Logger);
      expect(await moduleRef.resolve(PinoLogger)).toBeInstanceOf(PinoLogger);
      expect(moduleRef.get<Params>(PARAMS_PROVIDER_TOKEN)).toBe(params);
    });

    it('Logger не request-scoped — достаётся синхронным get()', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ pinoHttp: [{ level: 'trace' }, stream] }),
        ],
      }).compile();

      // Именно так его берёт bootstrap: app.useLogger(app.get(Logger))
      expect(() => moduleRef.get(Logger)).not.toThrow();
    });

    it('работает без параметров вообще', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule.forRoot()],
      }).compile();

      expect(moduleRef.get<Params>(PARAMS_PROVIDER_TOKEN)).toEqual({});
      expect(moduleRef.get(Logger)).toBeInstanceOf(Logger);
    });

    it('PinoLogger транзиентный: setContext одного не влияет на другой', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ pinoHttp: [{ level: 'trace' }, stream] }),
        ],
      }).compile();

      const first = await moduleRef.resolve(PinoLogger);
      const second = await moduleRef.resolve(PinoLogger);

      first.setContext('First');
      first.info('от первого');
      second.info('от второго');

      expect(stream.logs[0]).toMatchObject({ context: 'First' });
      expect(stream.logs[1]).not.toHaveProperty('context');
    });
  });

  describe('forRootAsync', () => {
    it('собирает параметры фабрикой с imports/inject', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRootAsync({
            imports: [StreamModule],
            inject: [StreamHolder],
            useFactory: (holder: StreamHolder): Params => ({
              pinoHttp: [{ level: 'trace' }, holder.stream],
            }),
          }),
        ],
      }).compile();

      const holder = moduleRef.get(StreamHolder, { strict: false });
      const logger = moduleRef.get(Logger);

      logger.log('через фабрику');

      expect(holder.stream.last).toMatchObject({ msg: 'через фабрику' });
    });

    it('поддерживает асинхронную фабрику', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRootAsync({
            useFactory: async (): Promise<Params> => ({
              pinoHttp: [{ level: 'trace' }, stream],
            }),
          }),
        ],
      }).compile();

      moduleRef.get(Logger).log('из асинхронной фабрики');

      expect(stream.last).toMatchObject({ msg: 'из асинхронной фабрики' });
    });

    it('регистрирует дополнительные providers', async () => {
      const token = 'EXTRA';

      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRootAsync({
            providers: [{ provide: token, useValue: 'значение' }],
            useFactory: (): Params => ({
              pinoHttp: [{ level: 'trace' }, stream],
            }),
          }),
        ],
      }).compile();

      expect(moduleRef.get(token, { strict: false })).toBe('значение');
    });
  });
});
