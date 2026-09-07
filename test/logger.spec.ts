import { CaptureStream } from './helpers/capture-stream';
import { Logger } from '../src/logger';
import { Params } from '../src/params';
import { __resetRootLoggerForTests, PinoLogger } from '../src/pino-logger';

function createLogger(
  stream: CaptureStream,
  extra: Partial<Params> = {},
): Logger {
  const params: Params = { pinoHttp: [{ level: 'trace' }, stream], ...extra };

  return new Logger(new PinoLogger(params), params);
}

describe('Logger (адаптер LoggerService)', () => {
  let stream: CaptureStream;

  beforeEach(() => {
    __resetRootLoggerForTests();
    stream = new CaptureStream();
  });

  it('маппит уровни NestJS на уровни pino', () => {
    const logger = createLogger(stream);

    logger.verbose('v');
    logger.debug('d');
    logger.log('l');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(stream.logs.map((log) => [log.level, log.msg])).toEqual([
      [10, 'v'],
      [20, 'd'],
      [30, 'l'],
      [40, 'w'],
      [50, 'e'],
      [60, 'f'],
    ]);
  });

  it('пишет строку сообщением, без лишних полей', () => {
    createLogger(stream).warn('что-то пошло не так');

    expect(stream.last).toMatchObject({
      level: 40,
      msg: 'что-то пошло не так',
    });
    expect(stream.last).not.toHaveProperty('context');
  });

  it('последний дополнительный аргумент кладёт в context', () => {
    createLogger(stream).log('готово', 'AppService');

    expect(stream.last).toMatchObject({ msg: 'готово', context: 'AppService' });
  });

  it('Error первым аргументом уходит в err со стектрейсом', () => {
    const error = new Error('boom');

    createLogger(stream).error(error, 'DomainExceptionFilter');

    expect(stream.last).toMatchObject({
      level: 50,
      context: 'DomainExceptionFilter',
      err: { type: 'Error', message: 'boom' },
    });
    expect(stream.last.err.stack).toContain('boom');
  });

  it('объект первым аргументом расплющивается в поля записи', () => {
    createLogger(stream).log({ userId: 42, action: 'login' }, 'AuthService');

    expect(stream.last).toMatchObject({
      userId: 42,
      action: 'login',
      context: 'AuthService',
    });
  });

  it('распознаёт контракт *ExceptionsHandler (message, stack, context)', () => {
    const stack = 'Error: boom\n    at handler (/app/main.js:1:1)';

    createLogger(stream).error('boom', stack, 'ExceptionsHandler');

    expect(stream.last).toMatchObject({
      context: 'ExceptionsHandler',
      err: { type: 'Error', message: 'boom', stack },
    });
    // Сообщение уехало в err.message — pino подставляет его же в msg
    expect(stream.last.msg).toBe('boom');
  });

  it('строка со стектрейсом без контекста трактуется как обычный параметр', () => {
    const stack = 'Error: boom\n    at handler (/app/main.js:1:1)';

    createLogger(stream).error('boom', stack);

    expect(stream.last).toMatchObject({ msg: 'boom', context: stack });
  });

  it('renameContext переименовывает поле контекста', () => {
    createLogger(stream, { renameContext: 'source' }).log(
      'готово',
      'AppService',
    );

    expect(stream.last).toMatchObject({ msg: 'готово', source: 'AppService' });
    expect(stream.last).not.toHaveProperty('context');
  });
});
