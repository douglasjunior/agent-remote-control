import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { Preferences } from '../models/preferences.model.js';
import type { IPreferencesStorePort, PreferencesChange } from '../ports/preferences-store.port.js';


const PREFERENCES_FILENAME = 'preferences.json';

@Injectable()
export class JsonPreferencesStoreAdapter implements IPreferencesStorePort {
  private readonly file: LockedFile<Preferences>;

  constructor(dataDirectoryService: DataDirectoryService, @Inject(ILockedFilesPort) files: ILockedFilesPort) {
    this.file = files.json<Preferences>(join(dataDirectoryService.resolve(), PREFERENCES_FILENAME), {
      parse: (content) => {
        const parsed = content as Partial<Record<keyof Preferences, unknown>> | null;
        return {
          ...(typeof parsed?.language === 'string' ? { language: parsed.language } : {}),
          ...(typeof parsed?.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
        };
      },
      empty: {},
    });
  }

  load(): Promise<Preferences> {
    return this.file.read();
  }

  update(change: PreferencesChange): Promise<Preferences> {
    return this.file.update((current) => {
      const changes = change(current);
      return changes && { ...current, ...changes, updatedAt: new Date().toISOString() };
    });
  }
}
