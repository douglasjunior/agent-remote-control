import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { PreferencesEntity } from '../entities/preferences.entity.js';


const PREFERENCES_FILE = 'preferences.json';

/** The JSON store read a field of another type, and a `null` file, as missing. */
const preferencesFileSchema = z.object({
  language: z.string().optional().catch(undefined),
  updatedAt: z.string().optional().catch(undefined),
}).nullable();

/** `DATA_DIR/preferences.json`, the language agents write to the user in. */
@Injectable()
export class JsonPreferencesImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'preferences';

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const stored = await this.files.read(PREFERENCES_FILE, preferencesFileSchema);
    const language = stored?.language ?? null;
    const updatedAt = stored?.updatedAt ?? null;
    return {
      files: stored === undefined ? [] : [PREFERENCES_FILE],
      counts: { languages: language ? 1 : 0 },
      write: async (manager: EntityManager) => {
        if (language || updatedAt) {
          await manager.createQueryBuilder().insert().into(PreferencesEntity).values({ id: 1, language, updatedAt }).orIgnore().execute();
        }
      },
    };
  }
}
