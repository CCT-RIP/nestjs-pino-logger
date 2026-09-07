/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  // Каждый spec поднимает свой Nest-контейнер и свой pino-транспорт —
  // изоляция по файлам обязательна: PinoLogger.root и outOfContext глобальны.
  maxWorkers: 1,
};
