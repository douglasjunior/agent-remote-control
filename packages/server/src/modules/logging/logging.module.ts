import { Module } from '@nestjs/common';
import { join } from 'node:path';

import { PathsModule } from '../paths/paths.module.js';
import { DataDirectoryService } from '../paths/services/data-directory.service.js';

import { FileConsoleLoggerAdapter } from './adapters/file-console-logger.adapter.js';
import { IAppLoggerPort } from './ports/app-logger.port.js';


const DEFAULT_RETENTION_DAYS = 14;

function retentionDays(): number {
  const days = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

@Module({
  imports: [PathsModule],
  providers: [
    {
      provide: IAppLoggerPort,
      inject: [DataDirectoryService],
      useFactory: (dataDirectory: DataDirectoryService) => new FileConsoleLoggerAdapter(join(dataDirectory.resolve(), 'logs'), retentionDays()),
    },
  ],
  exports: [IAppLoggerPort],
})
export class LoggingModule {}
