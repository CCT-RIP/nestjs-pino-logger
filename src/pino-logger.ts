import { Inject, Injectable, Scope } from '@nestjs/common';
import { Params, PARAMS_PROVIDER_TOKEN } from './params';
import pino from 'pino';
import { storage } from './storage';

type PinoMethods = Pick<
  pino.Logger,
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
>;

/**
 * Локальная копия `pino.LogFn`. Отличается тем, что записана объединением
 * сигнатур, а не перегрузками: только в таком виде TypeScript разрешает
 * реализовать методы `trace`/`debug`/... одной функцией с перегрузками сверху.
 */
type LoggerFn =
  | ((msg: string, ...args: any[]) => void)
  | ((obj: object, msg?: string, ...args: any[]) => void);

/**
 * Единственный на процесс pino-логгер. Из него растут и request-логгеры
 * `pino-http`, и логи вне запроса, поэтому транспорт (`pino-pretty` и т.п.)
 * поднимается ровно один раз.
 */
let rootLogger: pino.Logger | undefined;

function isDestinationStream(value: unknown): value is pino.DestinationStream {
  // Тот же признак, по которому поток от объекта опций отличает сам pino-http
  return (
    typeof value === 'object' && value !== null && '_writableState' in value
  );
}

function createRootLogger(pinoHttp: Params['pinoHttp']): pino.Logger {
  if (Array.isArray(pinoHttp)) {
    return pino(pinoHttp[0], pinoHttp[1]);
  }

  if (isDestinationStream(pinoHttp)) {
    return pino(pinoHttp);
  }

  if (
    typeof pinoHttp === 'object' &&
    pinoHttp !== null &&
    'stream' in pinoHttp &&
    typeof pinoHttp.stream !== 'undefined'
  ) {
    return pino(pinoHttp, pinoHttp.stream);
  }

  return pino((pinoHttp ?? {}) as pino.LoggerOptions);
}

/**
 * Создаёт корневой логгер (или возвращает уже созданный) и публикует его в
 * {@link PinoLogger.root}. Вызывается и из конструктора {@link PinoLogger}, и
 * при сборке middleware — кто окажется первым, тот и инициализирует.
 *
 * @internal
 */
export function resolveRootLogger(pinoHttp: Params['pinoHttp']): pino.Logger {
  if (!rootLogger) {
    rootLogger = createRootLogger(pinoHttp);
    // @ts-expect-error root объявлен readonly — здесь он и присваивается
    PinoLogger.root = rootLogger;
  }

  return rootLogger;
}

/**
 * Сбрасывает модульное состояние между тестами. Публичного применения не имеет.
 *
 * @internal
 */
export function __resetRootLoggerForTests(): void {
  rootLogger = undefined;
  // @ts-expect-error root объявлен readonly, здесь он сбрасывается намеренно
  PinoLogger.root = undefined;
}

/**
 * Логгер приложения с pino-подобным API.
 *
 * Транзиентный: у каждого потребителя свой экземпляр, поэтому
 * {@link PinoLogger.setContext} одного сервиса не влияет на другие.
 * Сам pino-логгер при этом общий — берётся из request-scope, если вызов
 * происходит внутри HTTP-запроса, иначе корневой.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class PinoLogger implements PinoMethods {
  /**
   * Самый корневой pino-логгер. Через него можно менять параметры в рантайме
   * (например `PinoLogger.root.level = 'trace'`) и логировать вне запроса.
   *
   * Проставляется при инициализации `LoggerModule`.
   */
  static readonly root: pino.Logger;

  protected context = '';

  protected readonly contextName: string;

  protected readonly errorKey: string;

  constructor(
    @Inject(PARAMS_PROVIDER_TOKEN) { pinoHttp, renameContext }: Params,
  ) {
    const options = Array.isArray(pinoHttp) ? pinoHttp[0] : pinoHttp;

    this.errorKey =
      typeof options === 'object' &&
      options !== null &&
      'customAttributeKeys' in options &&
      typeof options.customAttributeKeys !== 'undefined'
        ? (options.customAttributeKeys.err ?? 'err')
        : 'err';

    resolveRootLogger(pinoHttp);

    this.contextName = renameContext || 'context';
  }

  /**
   * Нативный pino-логгер: запросный внутри HTTP-запроса, иначе корневой.
   */
  get logger(): pino.Logger {
    // rootLogger всегда проинициализирован конструктором до первого вызова
    return storage.getStore()?.logger ?? (rootLogger as pino.Logger);
  }

  trace(msg: string, ...args: any[]): void;
  trace(obj: unknown, msg?: string, ...args: any[]): void;
  trace(...args: Parameters<LoggerFn>): void {
    this.call('trace', ...args);
  }

  debug(msg: string, ...args: any[]): void;
  debug(obj: unknown, msg?: string, ...args: any[]): void;
  debug(...args: Parameters<LoggerFn>): void {
    this.call('debug', ...args);
  }

  info(msg: string, ...args: any[]): void;
  info(obj: unknown, msg?: string, ...args: any[]): void;
  info(...args: Parameters<LoggerFn>): void {
    this.call('info', ...args);
  }

  warn(msg: string, ...args: any[]): void;
  warn(obj: unknown, msg?: string, ...args: any[]): void;
  warn(...args: Parameters<LoggerFn>): void {
    this.call('warn', ...args);
  }

  error(msg: string, ...args: any[]): void;
  error(obj: unknown, msg?: string, ...args: any[]): void;
  error(...args: Parameters<LoggerFn>): void {
    this.call('error', ...args);
  }

  fatal(msg: string, ...args: any[]): void;
  fatal(obj: unknown, msg?: string, ...args: any[]): void;
  fatal(...args: Parameters<LoggerFn>): void {
    this.call('fatal', ...args);
  }

  /**
   * Подмешивает поле `context` во все записи этого экземпляра.
   */
  setContext(value: string): void {
    this.context = value;
  }

  /**
   * Добавляет поля ко всем последующим логам текущего запроса.
   * Вне request-scope добавлять нечего — метод бросает исключение.
   */
  assign(fields: pino.Bindings): void {
    const store = storage.getStore();

    if (!store) {
      throw new Error(
        `${PinoLogger.name}: невозможно добавить поля вне request scope`,
      );
    }

    store.logger = store.logger.child(fields);
    store.responseLogger?.setBindings(fields);
  }

  protected call(method: pino.Level, ...args: Parameters<LoggerFn>): void {
    if (this.context) {
      if (typeof args[0] === 'object' && args[0] !== null) {
        const [first, ...rest] = args;

        args = [
          first instanceof Error
            ? { [this.contextName]: this.context, [this.errorKey]: first }
            : { [this.contextName]: this.context, ...first },
          ...rest,
        ] as Parameters<LoggerFn>;
      } else {
        args = [
          { [this.contextName]: this.context },
          ...args,
        ] as Parameters<LoggerFn>;
      }
    }

    // @ts-expect-error args — объединение кортежей, перегрузку не выбрать
    this.logger[method](...args);
  }
}
