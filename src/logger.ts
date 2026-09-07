import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { Params, PARAMS_PROVIDER_TOKEN } from './params';
import { PinoLogger } from './pino-logger';
import type { Level } from 'pino';

/**
 * Адаптер под штатный `LoggerService` NestJS: то, что передаётся в
 * `app.useLogger()` и инжектится в фильтры/сервисы, когда нужен привычный
 * nest-овый контракт `(message, ...optionalParams)`.
 *
 * Провайдер намеренно не request-scoped: иначе `app.get(Logger)` в bootstrap
 * бросил бы исключение. Привязка к запросу приходит не из скоупа провайдера,
 * а из `AsyncLocalStorage` внутри {@link PinoLogger}.
 */
@Injectable()
export class Logger implements LoggerService {
  private readonly contextName: string;

  constructor(
    protected readonly logger: PinoLogger,
    @Inject(PARAMS_PROVIDER_TOKEN) { renameContext }: Params,
  ) {
    this.contextName = renameContext || 'context';
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.call('trace', message, ...optionalParams);
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.call('debug', message, ...optionalParams);
  }

  log(message: any, ...optionalParams: any[]): void {
    this.call('info', message, ...optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.call('warn', message, ...optionalParams);
  }

  error(message: any, ...optionalParams: any[]): void {
    this.call('error', message, ...optionalParams);
  }

  fatal(message: any, ...optionalParams: any[]): void {
    this.call('fatal', message, ...optionalParams);
  }

  private call(level: Level, message: any, ...optionalParams: any[]): void {
    const objArg: Record<string, any> = {};

    // Конвенция NestJS: последний дополнительный аргумент — это контекст
    // (обычно имя класса), всё остальное уходит в pino как аргументы формата
    let params: any[] = [];

    if (optionalParams.length !== 0) {
      objArg[this.contextName] = optionalParams[optionalParams.length - 1];
      params = optionalParams.slice(0, -1);
    }

    if (typeof message === 'object' && message !== null) {
      if (message instanceof Error) {
        objArg.err = message;
      } else {
        Object.assign(objArg, message);
      }

      this.logger[level](objArg, ...params);
    } else if (this.isWrongExceptionsHandlerContract(level, message, params)) {
      objArg.err = new Error(message);
      (objArg.err as Error).stack = params[0];

      this.logger[level](objArg);
    } else {
      this.logger[level](objArg, message, ...params);
    }
  }

  /**
   * Встроенные (и не только) классы вида `^.*Exception(s?)Handler$` вызывают
   * `.error` по не поддерживаемому контракту — сообщением и стектрейсом
   * отдельными строками:
   *
   * - `ExceptionsHandler`
   *   @see https://github.com/nestjs/nest/blob/master/packages/core/exceptions/base-exception-filter.ts
   * - `ExceptionHandler`
   *   @see https://github.com/nestjs/nest/blob/master/packages/core/errors/exception-handler.ts
   * - `WsExceptionsHandler`
   *   @see https://github.com/nestjs/nest/blob/master/packages/websockets/exceptions/base-ws-exception-filter.ts
   * - `RpcExceptionsHandler`
   *   @see https://github.com/nestjs/nest/blob/master/packages/microservices/exceptions/base-rpc-exception-filter.ts
   *
   * Без распознавания этого случая стектрейс необработанного исключения
   * уехал бы в поле `context` вместо `err.stack`.
   */
  private isWrongExceptionsHandlerContract(
    level: Level,
    message: any,
    params: any[],
  ): params is [string] {
    return (
      level === 'error' &&
      typeof message === 'string' &&
      params.length === 1 &&
      typeof params[0] === 'string' &&
      /\n\s*at /.test(params[0])
    );
  }
}
