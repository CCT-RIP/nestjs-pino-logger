import type {
  MiddlewareConfigProxy,
  ModuleMetadata,
} from '@nestjs/common/interfaces';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';

/**
 * DI-токен, под которым модуль кладёт в контейнер разобранные {@link Params}.
 * Экспортируется, чтобы приложение могло получить конфиг логгера в своих
 * провайдерах: `@Inject(PARAMS_PROVIDER_TOKEN) params: Params`.
 */
export const PARAMS_PROVIDER_TOKEN = 'pino-logger-params';

export interface Params {
  /**
   * Опции `pino-http`. Прокидываются в него как есть, поэтому здесь доступно
   * всё, что умеет `pino`/`pino-http`: `level`, `transport`, `redact`,
   * `genReqId`, `customLogLevel`, `autoLogging`, `serializers` и прочее.
   *
   * Поддержаны все три формы вызова `pinoHttp(...)`:
   * - объект опций,
   * - кортеж `[options, destination]`,
   * - объект опций с полем `stream`.
   *
   * @see https://github.com/pinojs/pino-http#pinohttpopts-stream
   */
  pinoHttp?: Options | DestinationStream | [Options, DestinationStream];

  /**
   * Маршруты, на которых middleware логгера **не** подключается: для них не
   * будет ни автолога запроса, ни request-scope (`storage.getStore()` вернёт
   * `undefined`). Чтобы отключить только автолог, оставив request-scope,
   * используй `pinoHttp.autoLogging`.
   *
   * Сигнатура повторяет `MiddlewareConfigProxy['exclude']` из NestJS.
   */
  exclude?: Parameters<MiddlewareConfigProxy['exclude']>;

  /**
   * Маршруты, на которых middleware логгера подключается.
   * По умолчанию — все запросы.
   *
   * Сигнатура повторяет `MiddlewareConfigProxy['forRoutes']` из NestJS.
   */
  forRoutes?: Parameters<MiddlewareConfigProxy['forRoutes']>;

  /**
   * Имя поля, в которое пишется контекст логгера.
   * По умолчанию `context`.
   */
  renameContext?: string;

  /**
   * Распространять ли {@link PinoLogger.assign} на логгер ответа — строку
   * «request completed», которую пишет `pino-http`. По умолчанию `assign`
   * влияет только на логи приложения внутри запроса.
   */
  assignResponse?: boolean;
}

export interface LoggerModuleAsyncParams extends Pick<
  ModuleMetadata,
  'imports' | 'providers'
> {
  useFactory: (...args: any[]) => Params | Promise<Params>;
  inject?: any[];
}
