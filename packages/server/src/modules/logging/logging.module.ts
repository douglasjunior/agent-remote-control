import { Module } from '@nestjs/common';
import { join } from 'node:path';

import { PathsModule } from '../paths/paths.module.js';
import { DataDirectoryService } from '../paths/services/data-directory.service.js';
import { IRuntimeSettingsPort } from '../settings/ports/runtime-settings.port.js';
import { SettingsModule } from '../settings/settings.module.js';

import { FileConsoleLoggerAdapter } from './adapters/file-console-logger.adapter.js';
import { IAppLoggerPort } from './ports/app-logger.port.js';
import { ConversationLogContextService } from './services/conversation-log-context.service.js';


@Module({
  imports: [PathsModule, SettingsModule],
  providers: [
    ConversationLogContextService,
    {
      provide: IAppLoggerPort,
      inject: [DataDirectoryService, IRuntimeSettingsPort, ConversationLogContextService],
      useFactory: (dataDirectory: DataDirectoryService, settings: IRuntimeSettingsPort, logContext: ConversationLogContextService) =>
        new FileConsoleLoggerAdapter(join(dataDirectory.resolve(), 'logs'), settings, logContext),
    },
  ],
  exports: [IAppLoggerPort, ConversationLogContextService],
})
export class LoggingModule {}
