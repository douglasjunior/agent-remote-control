import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';

import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module.js';
import { JsonArtifactsImporterAdapter } from '../artifacts/adapters/json-artifacts-importer.adapter.js';
import { JsonAgentSettingsImporterAdapter } from '../orchestrator/adapters/json-agent-settings-importer.adapter.js';
import { JsonOpenWorkImporterAdapter } from '../orchestrator/adapters/json-open-work-importer.adapter.js';
import { JsonPreferencesImporterAdapter } from '../orchestrator/adapters/json-preferences-importer.adapter.js';
import { JsonSessionsImporterAdapter } from '../orchestrator/adapters/json-sessions-importer.adapter.js';
import { PathsModule } from '../paths/paths.module.js';
import { DataDirectoryService } from '../paths/services/data-directory.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { JsonConversationsImporterAdapter } from '../web/adapters/json-conversations-importer.adapter.js';
import { JsonHistoriesImporterAdapter } from '../web/adapters/json-histories-importer.adapter.js';
import { JsonPromptHistoryImporterAdapter } from '../web/adapters/json-prompt-history-importer.adapter.js';
import { LegacyConversationEntryUpgraderService } from '../web/services/legacy-conversation-entry-upgrader.service.js';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from './constants/database-schema.constant.js';
import { ILegacyJsonImporterPort } from './ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from './services/legacy-json-files.service.js';
import { LegacyJsonImportService } from './services/legacy-json-import.service.js';
import { SqliteTransactionService } from './services/sqlite-transaction.service.js';


const LEGACY_JSON_IMPORTERS = [
  JsonConversationsImporterAdapter,
  JsonHistoriesImporterAdapter,
  JsonPromptHistoryImporterAdapter,
  JsonPreferencesImporterAdapter,
  JsonAgentSettingsImporterAdapter,
  JsonArtifactsImporterAdapter,
  JsonSessionsImporterAdapter,
  JsonOpenWorkImporterAdapter,
];

@Module({
  imports: [
    AgentDefinitionsModule,
    PathsModule,
    StorageModule,
    TypeOrmModule.forRootAsync({
      imports: [PathsModule],
      inject: [DataDirectoryService],
      useFactory: (dataDirectory: DataDirectoryService) => ({
        type: 'better-sqlite3',
        database: join(dataDirectory.resolve(), 'arc.sqlite'),
        entities: DATABASE_ENTITIES,
        migrations: DATABASE_MIGRATIONS,
        migrationsRun: true,
        synchronize: false,
        enableWAL: true,
      }),
    }),
  ],
  providers: [
    LegacyJsonFilesService,
    LegacyConversationEntryUpgraderService,
    ...LEGACY_JSON_IMPORTERS,
    { provide: ILegacyJsonImporterPort, useFactory: (...importers: ILegacyJsonImporterPort[]) => importers, inject: LEGACY_JSON_IMPORTERS },
    LegacyJsonImportService,
    SqliteTransactionService,
  ],
  exports: [TypeOrmModule, SqliteTransactionService],
})
export class DatabaseModule {}
