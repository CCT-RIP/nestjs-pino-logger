import {
  DynamicModule,
  Global,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
} from '@nestjs/common';
import {
  LoggerModuleAsyncParams,
  Params,
  PARAMS_PROVIDER_TOKEN,
} from './params';
import { PinoLogger, resolveRootLogger } from './pino-logger';
import { storage, Store } from './storage';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from './logger';
import type { Logger as PinoBaseLogger } from 'pino';
import { pinoHttp as createPinoHttp } from 'pino-http';

/**
 * NestJS@11 всё ещё поддерживает express@4-стиль `*`, поэтому оставляем его
 * ради обратной совместимости. На следующем мажоре Nest место `*` займёт
 * `/{*splat}`.
 */
const DEFAULT_ROUTES = [{ path: '*', method: RequestMethod.ALL }];

/**
 * Запрос/ответ после прохода через `pino-http`.
 * `allLogs` появляется, если middleware по какой-то причине навесили дважды, —
 * актуален последний логгер.
 */
type WithPinoLog<T> = T & {
  log?: PinoBaseLogger;
  allLogs?: PinoBaseLogger[];
};

type LoggerMiddleware = (req: any, res: any, next: NextFunction) => void;

@Global()
@Module({ providers: [Logger], exports: [Logger] })
export class LoggerModule implements NestModule {
  constructor(@Inject(PARAMS_PROVIDER_TOKEN) private readonly params: Params) {}

  static forRoot(params?: Params): DynamicModule {
    const paramsProvider: Provider = {
      provide: PARAMS_PROVIDER_TOKEN,
      useValue: params ?? {},
    };

    return {
      module: LoggerModule,
      providers: [Logger, PinoLogger, paramsProvider],
      exports: [Logger, PinoLogger, paramsProvider],
    };
  }

  static forRootAsync(params: LoggerModuleAsyncParams): DynamicModule {
    const paramsProvider: Provider = {
      provide: PARAMS_PROVIDER_TOKEN,
      useFactory: params.useFactory,
      inject: params.inject,
    };

    return {
      module: LoggerModule,
      imports: params.imports,
      providers: [
        Logger,
        PinoLogger,
        paramsProvider,
        ...(params.providers ?? []),
      ],
      exports: [Logger, PinoLogger, paramsProvider],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    const {
      exclude,
      forRoutes = DEFAULT_ROUTES,
      pinoHttp,
      assignResponse,
    } = this.params;

    const middlewares = createLoggerMiddlewares(pinoHttp, assignResponse);

    if (exclude) {
      consumer
        .apply(...middlewares)
        .exclude(...exclude)
        .forRoutes(...forRoutes);
    } else {
      consumer.apply(...middlewares).forRoutes(...forRoutes);
    }
  }
}

/**
 * Достаёт из {@link Params.pinoHttp} объект опций: у формы-потока опций нет,
 * у формы-кортежа они первым элементом.
 */
function extractHttpOptions(
  pinoHttp: Params['pinoHttp'],
): Record<string, unknown> {
  if (Array.isArray(pinoHttp)) {
    return pinoHttp[0] as Record<string, unknown>;
  }

  if (
    typeof pinoHttp === 'object' &&
    pinoHttp !== null &&
    !('_writableState' in pinoHttp)
  ) {
    return pinoHttp as Record<string, unknown>;
  }

  return {};
}

function createLoggerMiddlewares(
  pinoHttp: Params['pinoHttp'],
  assignResponse = false,
): LoggerMiddleware[] {
  const root = resolveRootLogger(pinoHttp);

  // `pino-http` получает уже готовый корневой логгер и делает от него child.
  // Так у процесса остаётся один destination (и один transport-воркер), а
  // `PinoLogger.root` гарантированно пишет туда же, куда и логи запросов
  const middleware = createPinoHttp({
    ...extractHttpOptions(pinoHttp),
    logger: root,
  });

  return [middleware, bindLoggerMiddlewareFactory(assignResponse)];
}

/**
 * Кладёт логгер запроса в `AsyncLocalStorage`: с этого момента и до конца
 * обработки любой лог получает `req.id`, а `storage.getStore()` доступен
 * из кода, до которого DI не дотягивается.
 */
function bindLoggerMiddlewareFactory(
  assignResponse: boolean,
): LoggerMiddleware {
  return function bindLoggerMiddleware(
    req: WithPinoLog<Request>,
    res: WithPinoLog<Response>,
    next: NextFunction,
  ): void {
    const log = req.allLogs?.[req.allLogs.length - 1] ?? req.log;
    const resLog = assignResponse
      ? (res.allLogs?.[res.allLogs.length - 1] ?? res.log)
      : undefined;

    storage.run(new Store(log, resLog), next);
  };
}
