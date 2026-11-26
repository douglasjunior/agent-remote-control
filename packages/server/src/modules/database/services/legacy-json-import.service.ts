import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LegacyImportEntity } from '../entities/legacy-import.entity.js';
import { ILegacyJsonImporterPort } from '../ports/legacy-json-importer.port.js';

import { LegacyJsonFilesService } from './legacy-json-files.service.js';


const BACKUP_DIRECTORY = 'legacy-json-backup';

/**
 * Imports the JSON files of earlier versions on boot. It runs in `onModuleInit` of the database module, which every
 * module that reads the database imports, so it finishes before their own hooks and before the server takes
 * connections.
 */
@Injectable()
export class LegacyJsonImportService implements OnModuleInit {
  private readonly logger = new Logger(LegacyJsonImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly files: LegacyJsonFilesService,
    @Inject(ILegacyJsonImporterPort) private readonly importers: readonly ILegacyJsonImporterPort[],
  ) {}

  onModuleInit(): Promise<void> {
    return this.importAll();
  }

  /**
   * Runs every importer not recorded yet, each in its own transaction, then moves the files it read to
   * `DATA_DIR/legacy-json-backup/<timestamp>/`. An importer that fails is logged and runs again on the next boot, and so
   * do the importers that require it.
   */
  async importAll(): Promise<void> {
    const backupDirectory = `${BACKUP_DIRECTORY}/${new Date().toISOString().replaceAll(':', '-')}`;
    for (const importer of this.importers) {
      try {
        await this.importOne(importer, backupDirectory);
      } catch (error) {
        this.logger.warn(`legacy_import_failed: ${importer.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async importOne(importer: ILegacyJsonImporterPort, backupDirectory: string): Promise<void> {
    const records = this.dataSource.getRepository(LegacyImportEntity);
    if (await records.existsBy({ importer: importer.name })) {
      return;
    }
    for (const required of importer.requires ?? []) {
      if (!await records.existsBy({ importer: required })) {
        this.logger.warn(`legacy_import_deferred: ${importer.name} waits for ${required}`);
        return;
      }
    }
    const legacy = await importer.read();
    await this.dataSource.transaction(async (manager) => {
      await legacy.write(manager);
      await manager.insert(LegacyImportEntity, { importer: importer.name, importedAt: new Date().toISOString(), counts: { ...legacy.counts } });
    });
    if (legacy.files.length === 0) {
      return;
    }
    const moved = await this.files.backUp(legacy.files, backupDirectory);
    const counts = Object.entries(legacy.counts).map(([kind, count]) => `${count} ${kind}`).join(', ');
    this.logger.log(`[Legacy Import] ${importer.name}: ${counts}; ${moved} of ${legacy.files.length} files moved to ${backupDirectory}`);
  }
}
