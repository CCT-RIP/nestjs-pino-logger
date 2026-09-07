import {
  Controller,
  Get,
  INestApplication,
  Module,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { CaptureStream } from './helpers/capture-stream';
import { Logger } from '../src/logger';
import { LoggerModule } from '../src/logger.module';
import { Params } from '../src/params';
import { __resetRootLoggerForTests, PinoLogger } from '../src/pino-logger';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { storage } from '../src/storage';

@Controller()
class TestController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(TestController.name);
  }

  @Get('ok')
  ok(): { ok: true } {
    this.logger.info({ userId: 42 }, 'внутри хендлера');

    return { ok: true };
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'up' };
  }

  @Get('secret')
  secret(): { ok: true } {
    return { ok: true };
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException();
  }

  @Get('boom')
  boom(): never {
    throw new Error('всё сломалось');
  }

  @Get('als')
  viaStorage(): { ok: true } {
    // Так до логгера запроса добирается код, до которого не дотягивается DI
    const log = storage.getStore()?.logger ?? PinoLogger.root;

    log.info('через storage');

    return { ok: true };
  }
}

/**
 * Обвязка приложения один в один как в проде: логгер подменяется до того, как
 * буфер стартовых сообщений будет слит.
 */
async function createApp(params: Params): Promise<INestApplication> {
  @Module({
    imports: [LoggerModule.forRoot(params)],
    controllers: [TestController],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  await app.init();

  return app;
}

const SILENT_PATH_PREFIXES = ['/health'];

function buildParams(
  stream: CaptureStream,
  extra: Partial<Params> = {},
): Params {
  return {
    pinoHttp: [
      {
        level: 'trace',
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) {
            return 'error';
          }

          if (res.statusCode >= 400) {
            return 'warn';
          }

          return 'info';
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          remove: true,
        },
        autoLogging: {
          ignore: (req) =>
            SILENT_PATH_PREFIXES.some((prefix) =>
              (req.url ?? '').startsWith(prefix),
            ),
        },
        genReqId: (req, res) => {
          const header = req.headers['x-request-id'];
          const id =
            (Array.isArray(header) ? header[0] : header) ?? randomUUID();

          res.setHeader('X-Request-Id', id);

          return id;
        },
      },
      stream,
    ],
    ...extra,
  };
}

describe('LoggerModule (e2e)', () => {
  let stream: CaptureStream;
  let app: INestApplication;

  beforeEach(() => {
    __resetRootLoggerForTests();
    stream = new CaptureStream();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('пишет одну строку на завершённый запрос', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer()).get('/ok').expect(200);

    const completed = stream.logs.filter((log) => log.res);

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: 30,
      req: { method: 'GET', url: '/ok' },
      res: { statusCode: 200 },
    });
    expect(completed[0].responseTime).toEqual(expect.any(Number));
  });

  it('берёт req.id из X-Request-Id и возвращает его в ответе', async () => {
    app = await createApp(buildParams(stream));

    const response = await request(app.getHttpServer())
      .get('/ok')
      .set('X-Request-Id', 'external-id')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('external-id');
    expect(stream.logs.find((log) => log.res)).toMatchObject({
      req: { id: 'external-id' },
    });
  });

  it('генерирует req.id, если заголовка не было', async () => {
    app = await createApp(buildParams(stream));

    const response = await request(app.getHttpServer()).get('/ok').expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('логи приложения внутри запроса получают его req.id', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer())
      .get('/ok')
      .set('X-Request-Id', 'external-id')
      .expect(200);

    expect(stream.logs).toContainEqual(
      expect.objectContaining({
        msg: 'внутри хендлера',
        userId: 42,
        context: 'TestController',
        req: expect.objectContaining({ id: 'external-id' }),
      }),
    );
  });

  it('логгер из storage — тот же логгер запроса', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer())
      .get('/als')
      .set('X-Request-Id', 'external-id')
      .expect(200);

    expect(stream.logs).toContainEqual(
      expect.objectContaining({
        msg: 'через storage',
        req: expect.objectContaining({ id: 'external-id' }),
      }),
    );
  });

  it('вне запроса storage пуст, а PinoLogger.root пишет в тот же поток', async () => {
    app = await createApp(buildParams(stream));

    expect(storage.getStore()).toBeUndefined();

    PinoLogger.root.info('вне запроса');

    expect(stream.last).toMatchObject({ msg: 'вне запроса' });
    expect(stream.last).not.toHaveProperty('req');
  });

  it('customLogLevel: 4xx пишется warn, 5xx — error', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer()).get('/not-found').expect(404);
    await request(app.getHttpServer()).get('/boom').expect(500);

    const completed = stream.logs.filter((log) => log.res);

    expect(completed.map((log) => [log.res.statusCode, log.level])).toEqual([
      [404, 40],
      [500, 50],
    ]);
  });

  it('autoLogging.ignore убирает автолог, но оставляет request-scope', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer()).get('/health').expect(200);

    expect(stream.logs.filter((log) => log.res)).toHaveLength(0);
  });

  it('redact вырезает секретные заголовки', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer())
      .get('/secret')
      .set('Authorization', 'Bearer s3cr3t')
      .set('Cookie', 'session=s3cr3t')
      .expect(200);

    const completed = stream.logs.find((log) => log.res);

    expect(completed?.req.headers).not.toHaveProperty('authorization');
    expect(completed?.req.headers).not.toHaveProperty('cookie');
    expect(completed?.req.headers).toHaveProperty('host');
  });

  it('необработанное исключение уезжает в лог со стектрейсом', async () => {
    app = await createApp(buildParams(stream));

    await request(app.getHttpServer()).get('/boom').expect(500);

    const fromFilter = stream.logs.find(
      (log) => log.err && log.err.message === 'всё сломалось',
    );

    expect(fromFilter).toBeDefined();
    expect(fromFilter?.err.stack).toContain('всё сломалось');
  });

  it('стартовые логи Nest уходят в pino после flushLogs', async () => {
    app = await createApp(buildParams(stream));

    expect(stream.logs).toContainEqual(
      expect.objectContaining({ context: 'RoutesResolver' }),
    );
  });

  it('exclude отключает и автолог, и request-scope на маршруте', async () => {
    app = await createApp(
      buildParams(stream, {
        exclude: [{ path: 'als', method: RequestMethod.ALL }],
      }),
    );

    await request(app.getHttpServer()).get('/als').expect(200);

    expect(stream.logs.filter((log) => log.res)).toHaveLength(0);

    // storage пуст — упали на PinoLogger.root, у записи нет req
    const fromStorage = stream.logs.find((log) => log.msg === 'через storage');

    expect(fromStorage).toBeDefined();
    expect(fromStorage).not.toHaveProperty('req');
  });

  it('forRoutes ограничивает маршруты, на которых работает логгер', async () => {
    app = await createApp(
      buildParams(stream, {
        forRoutes: [{ path: 'ok', method: RequestMethod.ALL }],
      }),
    );

    await request(app.getHttpServer()).get('/secret').expect(200);
    await request(app.getHttpServer()).get('/ok').expect(200);

    const completed = stream.logs.filter((log) => log.res);

    expect(completed).toHaveLength(1);
    expect(completed[0].req.url).toBe('/ok');
  });

  it("level 'silent' глушит и автолог, и логи приложения", async () => {
    app = await createApp({ pinoHttp: [{ level: 'silent' }, stream] });

    await request(app.getHttpServer()).get('/ok').expect(200);

    expect(stream.logs).toHaveLength(0);
  });
});
