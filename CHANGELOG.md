# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

## [0.1.0] — 2026-09-04

Первый выпуск.

### Добавлено

- `LoggerModule.forRoot` / `forRootAsync` — регистрация логгера и подключение
  middleware `pino-http`.
- `Logger` — адаптер под `LoggerService` NestJS: пригоден и для
  `app.useLogger()`, и для инъекции; разбирает контракт встроенных
  `*ExceptionsHandler` (`message`, `stack`, `context`).
- `PinoLogger` — транзиентный логгер с pino-подобным API: `trace`/`debug`/
  `info`/`warn`/`error`/`fatal`, `setContext`, `assign`, геттер `logger`,
  статический `root`.
- Сабпас `@cct-rip/nestjs-pino-logger/storage` — `storage`
  (`AsyncLocalStorage<Store>`) и `Store` для доступа к логгеру запроса вне DI.
- `Params`: `pinoHttp` (объект опций, `[options, stream]` или поток),
  `forRoutes`, `exclude`, `renameContext`, `assignResponse`.
- Один pino-инстанс на процесс: `pino-http` получает готовый корневой логгер,
  transport-воркер поднимается однократно.

[Unreleased]: https://github.com/CCT-RIP/nestjs-pino-logger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CCT-RIP/nestjs-pino-logger/releases/tag/v0.1.0
