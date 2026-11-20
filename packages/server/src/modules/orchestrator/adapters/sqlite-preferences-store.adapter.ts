import { Injectable } from '@nestjs/common';
import { DataSource, type Repository } from 'typeorm';

import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { PreferencesEntity } from '../entities/preferences.entity.js';
import type { Preferences } from '../models/preferences.model.js';
import type { IPreferencesStorePort, PreferencesChange } from '../ports/preferences-store.port.js';


/** The preferences are global to the instance, so they live in one row. */
const ROW_ID = 1;

const SELECT_PREFERENCES = 'SELECT "language", "updated_at" AS "updatedAt" FROM "preferences" WHERE "id" = ?';
const UPSERT_PREFERENCES = `
  INSERT INTO "preferences" ("id", "language", "updated_at") VALUES (?, ?, ?)
  ON CONFLICT ("id") DO UPDATE SET "language" = excluded."language", "updated_at" = excluded."updated_at"`;

type PreferencesRow = Pick<PreferencesEntity, 'language' | 'updatedAt'>;

@Injectable()
export class SqlitePreferencesStoreAdapter implements IPreferencesStorePort {
  private readonly preferences: Repository<PreferencesEntity>;

  constructor(dataSource: DataSource, private readonly transactions: SqliteTransactionService) {
    this.preferences = dataSource.getRepository(PreferencesEntity);
  }

  async load(): Promise<Preferences> {
    return this.toPreferences(await this.preferences.findOneBy({ id: ROW_ID }));
  }

  async update(change: PreferencesChange): Promise<Preferences> {
    return this.transactions.run((statements) => {
      const current = this.toPreferences(statements.get<PreferencesRow>(SELECT_PREFERENCES, ROW_ID));
      const changes = change(current);
      if (!changes) {
        return current;
      }
      const next: PreferencesRow = { language: { ...current, ...changes }.language ?? null, updatedAt: new Date().toISOString() };
      statements.run(UPSERT_PREFERENCES, ROW_ID, next.language, next.updatedAt);
      return this.toPreferences(next);
    });
  }

  private toPreferences(row: PreferencesRow | null | undefined): Preferences {
    return {
      ...(row?.language ? { language: row.language } : {}),
      ...(row?.updatedAt ? { updatedAt: row.updatedAt } : {}),
    };
  }
}
