import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type Repository } from 'typeorm';

import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { SettingEntity } from '../entities/setting.entity.js';
import type { SavedSettings } from '../models/resolved-setting.model.js';
import type { ISettingsStorePort } from '../ports/settings-store.port.js';


const UPSERT_SETTING = `
  INSERT INTO "setting" ("key", "value", "updated_at") VALUES (?, ?, ?)
  ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value", "updated_at" = excluded."updated_at"`;

type SettingRow = Pick<SettingEntity, 'key' | 'value'>;

@Injectable()
export class SqliteSettingsStoreAdapter implements ISettingsStorePort {
  private readonly logger = new Logger(SqliteSettingsStoreAdapter.name);
  private readonly settings: Repository<SettingEntity>;

  constructor(dataSource: DataSource, private readonly transactions: SqliteTransactionService) {
    this.settings = dataSource.getRepository(SettingEntity);
  }

  async load(): Promise<SavedSettings> {
    return this.toSettings(await this.settings.find({ select: { key: true, value: true } }));
  }

  async save(values: SavedSettings, removed: readonly string[]): Promise<SavedSettings> {
    const now = new Date().toISOString();
    return this.transactions.run((statements) => {
      for (const [key, value] of Object.entries(values)) {
        statements.run(UPSERT_SETTING, key, JSON.stringify(value), now);
      }
      for (const key of removed) {
        statements.run('DELETE FROM "setting" WHERE "key" = ?', key);
      }
      return this.toSettings(statements.all<SettingRow>('SELECT "key", "value" FROM "setting"'));
    });
  }

  /** A value that is not JSON is left out and logged, so the setting falls back to its variable or default. */
  private toSettings(rows: readonly SettingRow[]): SavedSettings {
    const settings: Record<string, unknown> = {};
    for (const { key, value } of rows) {
      try {
        settings[key] = JSON.parse(value);
      } catch {
        this.logger.warn(`setting_unreadable: ${key} is not JSON; ignored`);
      }
    }
    return settings;
  }
}
