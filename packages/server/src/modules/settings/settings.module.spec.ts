import { DataSource } from 'typeorm';

import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { IRuntimeSettingsPort } from './ports/runtime-settings.port.js';
import { ISettingsChangeNotifierPort } from './ports/settings-change-notifier.port.js';
import { SettingsChangeNotifierService } from './services/settings-change-notifier.service.js';
import { SettingsModule } from './settings.module.js';
import { ChangeSettingsUseCase } from './use-cases/change-settings.use-case.js';


describe('SettingsModule', () => {
  useTemporaryDataDir();

  it('should resolve the settings saved before it started, and apply the ones saved while it runs', async () => {
    const first = await createTestingModule({ imports: [SettingsModule] }).compile();
    await first.get(DataSource).query('INSERT INTO "setting" VALUES (\'QUESTION_TIMEOUT_MS\', \'1500\', \'2026-01-01\')');
    await first.close();

    const module = await createTestingModule({ imports: [SettingsModule] }).compile();
    const settings = module.get<IRuntimeSettingsPort>(IRuntimeSettingsPort);

    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 1500, source: 'saved' });
    await module.get(ChangeSettingsUseCase).execute({ values: { QUESTION_TIMEOUT_MS: 0 } });
    expect(settings.get('QUESTION_TIMEOUT_MS')).toBe(0);
    expect(module.get(ISettingsChangeNotifierPort)).toBeInstanceOf(SettingsChangeNotifierService);
    await module.close();
  });
});
