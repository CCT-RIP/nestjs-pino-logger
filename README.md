# @cct-rip/nestjs-pino-logger

Структурированное логирование для NestJS поверх [`pino`](https://getpino.io) и
[`pino-http`](https://github.com/pinojs/pino-http):

- автоматический лог каждого завершённого HTTP-запроса;
- весь встроенный вывод Nest (маршруты на старте, `ExceptionFilter`,
  `ClassSerializerInterceptor`) — через pino;
- request-scope на `AsyncLocalStorage`: любой лог внутри запроса получает его
  `req.id`, даже из кода, до которого не дотягивается DI.

Пакет без рантайм-зависимостей: `pino`, `pino-http` и `@nestjs/common` — peer.

## Установка

```bash
pnpm add @cct-rip/nestjs-pino-logger pino pino-http
# для человекочитаемого вывода в dev
pnpm add -D pino-pretty
```

| peer             | поддерживаемые версии    |
|------------------|--------------------------|
| `@nestjs/common` | `^10.0.0 \|\| ^11.0.0`   |
| `pino`           | `^9.0.0 \|\| ^10.0.0`    |
| `pino-http`      | `^10.0.0 \|\| ^11.0.0`   |

Node.js — 20 и новее.

## Быстрый старт

```ts
// app.module.ts
import { LoggerModule } from '@cct-rip/nestjs-pino-logger';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
  ],
})
export class AppModule {}
```

```ts
// main.ts
import { AppModule } from './app.module';
import { Logger } from '@cct-rip/nestjs-pino-logger';
import { NestFactory } from '@nestjs/core';

async function bootstrap(): Promise<void> {
  // bufferLogs: стартовые сообщения копятся, пока логгер не подменён на pino
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  await app.listen(3000);
}

void bootstrap();
```

`LoggerModule` помечен `@Global()` — импортировать его в каждом модуле не нужно.

## Асинхронная конфигурация

```ts
LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): Params => ({
    pinoHttp: { level: config.logLevel },
  }),
});
```

Принимает `imports`, `inject`, `useFactory` (можно async) и дополнительные
`providers`, которые нужны только фабрике.

## Логирование из кода

### `PinoLogger` — pino-подобный API

```ts
import { Injectable } from '@nestjs/common';
import { PinoLogger } from '@cct-rip/nestjs-pino-logger';

@Injectable()
export class PostsService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PostsService.name);
  }

  async publish(id: number): Promise<void> {
    this.logger.info({ postId: id }, 'публикую пост');
  }
}
```

Первым аргументом идёт объект с полями, вторым — текст сообщения.
Доступны `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

Провайдер транзиентный: `setContext` одного сервиса не влияет на другие.

### `Logger` — штатный контракт NestJS

```ts
import { Logger } from '@cct-rip/nestjs-pino-logger';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: Error): void {
    this.logger.error(exception, DomainExceptionFilter.name);
  }
}
```

Реализует `LoggerService`, поэтому годится и для `app.useLogger()`, и для
инъекции. Уровни маппятся так: `verbose → trace`, `debug → debug`,
`log → info`, `warn → warn`, `error → error`, `fatal → fatal`.

Провайдер **не** request-scoped — `app.get(Logger)` в bootstrap работает.

## Request-scope: `req.id` и `storage`

Middleware кладёт логгер запроса в `AsyncLocalStorage`, поэтому все логи внутри
обработки запроса автоматически получают его `req.id`. Если до логгера нужно
добраться там, где DI недоступен (декоратор метода, хелпер, статический
контекст), берите его из хранилища напрямую:

```ts
import { PinoLogger } from '@cct-rip/nestjs-pino-logger';
import { storage } from '@cct-rip/nestjs-pino-logger/storage';
import type { Logger as PinoBaseLogger } from 'pino';

/** Логгер текущего запроса, а вне request scope — корневой */
function requestLogger(): PinoBaseLogger {
  return storage.getStore()?.logger ?? PinoLogger.root;
}
```

`PinoLogger.root` — корневой pino-логгер процесса. Через него же можно менять
настройки в рантайме: `PinoLogger.root.level = 'trace'`.

`PinoLogger.assign(fields)` добавляет поля ко всем последующим логам текущего
запроса (вне запроса бросает исключение):

```ts
this.logger.assign({ userId: user.id });
```

## Сквозной request-id

Пакет не навязывает схему идентификатора — она собирается штатным
`pinoHttp.genReqId`:

```ts
import { randomUUID } from 'node:crypto';

pinoHttp: {
  genReqId: (req, res) => {
    const header = req.headers['x-request-id'];
    const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();

    res.setHeader('X-Request-Id', id);

    return id;
  },
}
```

## Параметры (`Params`)

| Поле             | Тип                                                        | Описание |
|------------------|------------------------------------------------------------|----------|
| `pinoHttp`       | `Options \| DestinationStream \| [Options, DestinationStream]` | Опции `pino-http`, прокидываются как есть: `level`, `transport`, `redact`, `serializers`, `genReqId`, `customLogLevel`, `autoLogging`, `customProps`, `customAttributeKeys` и прочее |
| `forRoutes`      | `Parameters<MiddlewareConfigProxy['forRoutes']>`            | Маршруты, на которых работает логгер. По умолчанию — все |
| `exclude`        | `Parameters<MiddlewareConfigProxy['exclude']>`              | Маршруты-исключения: ни автолога, ни request-scope |
| `renameContext`  | `string`                                                    | Имя поля контекста вместо `context` |
| `assignResponse` | `boolean`                                                   | Распространять `assign` и на строку «request completed» |

Чтобы убрать автолог, но сохранить request-scope, используйте не `exclude`, а
`pinoHttp.autoLogging.ignore`:

```ts
autoLogging: {
  ignore: (req) => (req.url ?? '').startsWith('/health'),
}
```

Секреты вырезаются штатным `redact`:

```ts
redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie'],
  remove: true,
}
```

## Тесты приложения

Логгер поднимается так же, как в проде, и глушится уровнем:

```ts
process.env.LOG_LEVEL ??= 'silent';
```

## Экспорты

| Импорт | Что отдаёт |
|--------|------------|
| `@cct-rip/nestjs-pino-logger` | `LoggerModule`, `Logger`, `PinoLogger`, `Params`, `LoggerModuleAsyncParams`, `PARAMS_PROVIDER_TOKEN` |
| `@cct-rip/nestjs-pino-logger/storage` | `storage` (`AsyncLocalStorage<Store>`), `Store` |

Пакет собирается только в CommonJS — намеренно: `storage` и `PinoLogger.root`
должны существовать в единственном экземпляре, а двойная ESM/CJS-сборка
породила бы две копии хранилища, и `getStore()` внутри запроса возвращал бы
`undefined`.

## Поведение, о котором стоит знать

- `Logger.error(message, context)` — последний дополнительный аргумент всегда
  трактуется как контекст (конвенция NestJS). Поэтому
  `logger.error('текст', error)` положит объект ошибки в поле `context`, а не в
  `err`. Чтобы ошибка попала в `err` со стектрейсом, передавайте её первым
  аргументом: `logger.error(error, 'FilesService')` — или используйте
  `PinoLogger`: `logger.error({ err: error }, 'текст')`.
- Вызов вида `error(message, stack, context)`, которым пользуются встроенные
  `*ExceptionsHandler` NestJS, распознаётся отдельно: сообщение и стектрейс
  собираются обратно в `err`.
- `pino-http` получает уже готовый корневой логгер и делает от него `child`, так
  что transport-воркер (`pino-pretty` и т.п.) поднимается один раз на процесс.

## Совместимость с `nestjs-pino`

Пакет повторяет публичный контракт [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino)
в том объёме, который используется в наших сервисах.

Реализовано: `LoggerModule.forRoot` / `forRootAsync`, `Logger`, `PinoLogger`
(включая `root`, `setContext`, `assign`), `Params`
(`pinoHttp`, `forRoutes`, `exclude`, `renameContext`, `assignResponse`),
сабпас `./storage` со `storage` и `Store`.

Намеренно не реализовано: `InjectPinoLogger` / `getLoggerToken`,
`LoggerErrorInterceptor`, `NativeLogger` и пресеты, `useExisting` (сценарий
Fastify с логгером в адаптере), `PassedLogger`.

## Лицензия

MIT
