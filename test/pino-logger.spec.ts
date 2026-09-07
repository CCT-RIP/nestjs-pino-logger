import { CaptureStream } from './helpers/capture-stream';
import { __resetRootLoggerForTests, PinoLogger } from '../src/pino-logger';
import { storage, Store } from '../src/storage';
import { Params } from '../src/params';
import pino from 'pino';

function createPinoLogger(
  stream: CaptureStream,
  extra: Partial<Params> = {},
): PinoLogger {
  const params: Params = { pinoHttp: [{ level: 'trace' }, stream], ...extra };

  return new PinoLogger(params);
}

describe('PinoLogger', () => {
  let stream: CaptureStream;

  beforeEach(() => {
    __resetRootLoggerForTests();
    stream = new CaptureStream();
  });

  it('поддерживает обе перегрузки pino: (msg) и (obj, msg)', () => {
    const logger = createPinoLogger(stream);

    logger.info('просто текст');
    logger.info({ postId: 7 }, 'публикую пост');

    expect(stream.logs).toMatchObject([
      { level: 30, msg: 'просто текст' },
      { level: 30, msg: 'публикую пост', postId: 7 },
    ]);
  });

  it('пишет все шесть уровней pino', () => {
    const logger = createPinoLogger(stream);

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(stream.logs.map((log) => log.level)).toEqual([
      10, 20, 30, 40, 50, 60,
    ]);
  });

  it('setContext подмешивает context в обе формы вызова', () => {
    const logger = createPinoLogger(stream);

    logger.setContext('PostsService');
    logger.info('без объекта');
    logger.info({ postId: 7 }, 'с объектом');

    expect(stream.logs).toMatchObject([
      { context: 'PostsService', msg: 'без объекта' },
      { context: 'PostsService', msg: 'с объектом', postId: 7 },
    ]);
  });

  it('с контекстом Error первым аргументом уходит в err', () => {
    const logger = createPinoLogger(stream);

    logger.setContext('PostsService');
    logger.error(new Error('boom'), 'не смог опубликовать');

    expect(stream.last).toMatchObject({
      context: 'PostsService',
      msg: 'не смог опубликовать',
      err: { type: 'Error', message: 'boom' },
    });
  });

  it('renameContext переименовывает поле контекста', () => {
    const logger = createPinoLogger(stream, { renameContext: 'source' });

    logger.setContext('PostsService');
    logger.info('привет');

    expect(stream.last).toMatchObject({ source: 'PostsService' });
    expect(stream.last).not.toHaveProperty('context');
  });

  it('customAttributeKeys.err меняет ключ, в который кладётся Error', () => {
    const logger = createPinoLogger(stream, {
      pinoHttp: [
        {
          level: 'trace',
          customAttributeKeys: { err: 'error' },
          // Так же поступает и pino-http: сериализатор ошибки переезжает
          // на кастомный ключ
          serializers: { error: pino.stdSerializers.err },
        },
        stream,
      ],
    });

    logger.setContext('PostsService');
    logger.error(new Error('boom'));

    expect(stream.last.error).toMatchObject({ type: 'Error', message: 'boom' });
    expect(stream.last).not.toHaveProperty('err');
  });

  it('логи внутри request-scope пишутся запросным логгером', () => {
    const logger = createPinoLogger(stream);
    const requestLogger = PinoLogger.root.child({ req: { id: 'abc' } });

    storage.run(new Store(requestLogger), () => {
      expect(logger.logger).toBe(requestLogger);
      logger.info('внутри запроса');
    });

    logger.info('вне запроса');

    expect(stream.logs[0]).toMatchObject({
      req: { id: 'abc' },
      msg: 'внутри запроса',
    });
    expect(stream.logs[1]).not.toHaveProperty('req');
  });

  it('assign добавляет поля ко всем последующим логам запроса', () => {
    const logger = createPinoLogger(stream);

    storage.run(new Store(PinoLogger.root.child({})), () => {
      logger.info('до assign');
      logger.assign({ userId: 42 });
      logger.info('после assign');
    });

    expect(stream.logs[0]).not.toHaveProperty('userId');
    expect(stream.logs[1]).toMatchObject({ userId: 42, msg: 'после assign' });
  });

  it('assign с assignResponse обновляет и логгер ответа', () => {
    const logger = createPinoLogger(stream, { assignResponse: true });
    const responseLogger = PinoLogger.root.child({});

    storage.run(new Store(PinoLogger.root.child({}), responseLogger), () => {
      logger.assign({ userId: 42 });
    });

    responseLogger.info('request completed');

    expect(stream.last).toMatchObject({ userId: 42 });
  });

  it('assign вне request-scope бросает исключение', () => {
    const logger = createPinoLogger(stream);

    expect(() => logger.assign({ userId: 42 })).toThrow(/вне request scope/);
  });

  it('PinoLogger.root доступен после создания логгера и пишет в тот же поток', () => {
    createPinoLogger(stream);

    expect(PinoLogger.root).toBeDefined();

    PinoLogger.root.warn('из корневого логгера');

    expect(stream.last).toMatchObject({
      level: 40,
      msg: 'из корневого логгера',
    });
  });

  it('принимает pinoHttp объектом опций со stream', () => {
    const logger = new PinoLogger({
      pinoHttp: { level: 'trace', stream },
    });

    logger.info('через stream');

    expect(stream.last).toMatchObject({ msg: 'через stream' });
  });

  it('принимает pinoHttp голым destination-потоком', () => {
    const logger = new PinoLogger({ pinoHttp: stream });

    logger.info('через destination');

    expect(stream.last).toMatchObject({ msg: 'через destination' });
  });

  it('корневой логгер создаётся один раз на процесс', () => {
    createPinoLogger(stream);
    const first: pino.Logger = PinoLogger.root;

    createPinoLogger(new CaptureStream());

    expect(PinoLogger.root).toBe(first);
  });
});
