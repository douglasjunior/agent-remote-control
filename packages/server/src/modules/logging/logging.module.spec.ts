import { Test } from '@nestjs/testing';

import { FileConsoleLoggerAdapter } from './adapters/file-console-logger.adapter.js';
import { LoggingModule } from './logging.module.js';
import { IAppLoggerPort } from './ports/app-logger.port.js';


describe('LoggingModule', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it.each([['7'], ['invalid'], ['0']])('should provide the file logger with LOG_RETENTION_DAYS=%s', async (days) => {
    rs.stubEnv('LOG_RETENTION_DAYS', days);

    const module = await Test.createTestingModule({ imports: [LoggingModule] }).compile();

    expect(module.get(IAppLoggerPort)).toBeInstanceOf(FileConsoleLoggerAdapter);
  });
});
