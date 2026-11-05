import { Module } from '@nestjs/common';
import { join } from 'node:path';

import { resolveDataDirectory } from '../orchestrator/utils/data-directory.util.js';

import { FileConsoleLoggerAdapter } from './adapters/file-console-logger.adapter.js';
import { IAppLoggerPort } from './ports/app-logger.port.js';


const DEFAULT_RETENTION_DAYS = 14;

function retentionDays(): number {
  const days = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

@Module({
  providers: [
    {
      provide: IAppLoggerPort,
      useFactory: () => new FileConsoleLoggerAdapter(join(resolveDataDirectory(), 'logs'), retentionDays()),
    },
  ],
  exports: [IAppLoggerPort],
})
export class LoggingModule {}
