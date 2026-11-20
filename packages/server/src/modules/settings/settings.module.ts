import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';

import { SqliteSettingsStoreAdapter } from './adapters/sqlite-settings-store.adapter.js';
import { IRuntimeSettingsPort } from './ports/runtime-settings.port.js';
import { ISettingsChangeNotifierPort } from './ports/settings-change-notifier.port.js';
import { ISettingsStorePort } from './ports/settings-store.port.js';
import { RuntimeSettingsService } from './services/runtime-settings.service.js';
import { SettingsChangeNotifierService } from './services/settings-change-notifier.service.js';
import { ChangeSettingsUseCase } from './use-cases/change-settings.use-case.js';
import { GetSettingsUseCase } from './use-cases/get-settings.use-case.js';


@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: ISettingsStorePort, useClass: SqliteSettingsStoreAdapter },
    {
      // Loaded in a factory, so a provider that reads a setting as it is built (the speech-to-text provider) sees the saved values.
      provide: RuntimeSettingsService,
      inject: [ISettingsStorePort],
      useFactory: async (store: ISettingsStorePort) => {
        const settings = new RuntimeSettingsService();
        settings.replaceSaved(await store.load());
        return settings;
      },
    },
    { provide: IRuntimeSettingsPort, useExisting: RuntimeSettingsService },
    { provide: ISettingsChangeNotifierPort, useClass: SettingsChangeNotifierService },
    GetSettingsUseCase,
    ChangeSettingsUseCase,
  ],
  exports: [IRuntimeSettingsPort, ISettingsChangeNotifierPort, GetSettingsUseCase, ChangeSettingsUseCase],
})
export class SettingsModule {}
