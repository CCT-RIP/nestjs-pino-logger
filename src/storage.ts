import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger as PinoBaseLogger } from 'pino';

/**
 * Содержимое request-scope: логгеры текущего HTTP-запроса.
 */
export class Store {
  constructor(
    /** Логгер запроса — уже с привязанным `req.id`. */
    public logger: PinoBaseLogger,
    /**
     * Логгер ответа `pino-http` (строка «request completed»).
     * Заполняется только при `Params.assignResponse`.
     */
    public responseLogger?: PinoBaseLogger,
  ) {}
}

/**
 * Хранилище request-scope. Экспортируется отдельным сабпасом
 * `@cct-rip/nestjs-pino-logger/storage`, чтобы до логгера текущего запроса
 * можно было добраться там, где DI недоступен (декораторы методов,
 * хелперы, вызываемые из статического контекста):
 *
 * ```ts
 * import { storage } from '@cct-rip/nestjs-pino-logger/storage';
 * import { PinoLogger } from '@cct-rip/nestjs-pino-logger';
 *
 * const log = storage.getStore()?.logger ?? PinoLogger.root;
 * ```
 */
export const storage = new AsyncLocalStorage<Store>();
