import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';

import { SqliteSettingsStoreAdapter } from './sqlite-settings-store.adapter.js';


describe('SqliteSettingsStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteSettingsStoreAdapter;
  const storeOver = () => new SqliteSettingsStoreAdapter(dataSource, new SqliteTransactionService(dataSource));

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver();
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
  });

  it('should start with nothing saved', async () => {
    await expect(store.load()).resolves.toEqual({});
  });

  it('should save values as JSON, replace them and remove keys in one step, for another store too', async () => {
    await store.save({ QUESTION_TIMEOUT_MS: 1500, DISCORD_GUILD_ID: '123' }, []);

    await expect(store.save({ QUESTION_TIMEOUT_MS: 0, SHELL_COMMAND_ENABLED: true }, ['DISCORD_GUILD_ID'])).resolves.toEqual({ QUESTION_TIMEOUT_MS: 0, SHELL_COMMAND_ENABLED: true });

    await expect(storeOver().load()).resolves.toEqual({ QUESTION_TIMEOUT_MS: 0, SHELL_COMMAND_ENABLED: true });
    expect(await dataSource.query('SELECT "key", "value" FROM "setting" ORDER BY "key"')).toEqual([
      { key: 'QUESTION_TIMEOUT_MS', value: '0' },
      { key: 'SHELL_COMMAND_ENABLED', value: 'true' },
    ]);
  });

  it('should keep every value of saves made together', async () => {
    await Promise.all([store.save({ QUESTION_TIMEOUT_MS: 1 }, []), storeOver().save({ LOG_RETENTION_DAYS: 2 }, [])]);

    await expect(store.load()).resolves.toEqual({ QUESTION_TIMEOUT_MS: 1, LOG_RETENTION_DAYS: 2 });
  });

  it('should leave out and log a value that is not JSON', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await dataSource.query('INSERT INTO "setting" VALUES (\'REMOTE_URL\', \'{broken\', \'2026-01-01\'), (\'LOG_RETENTION_DAYS\', \'7\', \'2026-01-01\')');

    await expect(store.load()).resolves.toEqual({ LOG_RETENTION_DAYS: 7 });
    expect(warn).toHaveBeenCalledWith('setting_unreadable: REMOTE_URL is not JSON; ignored');
  });

  it('should save nothing of a change the database refuses halfway', async () => {
    await store.save({ LOG_RETENTION_DAYS: 7 }, []);
    await dataSource.query('CREATE TRIGGER "refuse" BEFORE DELETE ON "setting" BEGIN SELECT RAISE(ABORT, \'refused\'); END');

    await expect(store.save({ QUESTION_TIMEOUT_MS: 1 }, ['LOG_RETENTION_DAYS'])).rejects.toThrow('refused');

    await expect(store.load()).resolves.toEqual({ LOG_RETENTION_DAYS: 7 });
  });
});
