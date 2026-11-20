import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { createTestingModule } from '../../../test/testing-module.js';

import { DATABASE_MIGRATIONS } from './constants/database-schema.constant.js';
import { DatabaseModule } from './database.module.js';
import { createInMemoryDataSource } from './testing/in-memory-data-source.js';


@Injectable()
class PromptsSeenOnInit implements OnModuleInit {
  prompts: unknown[] = [];

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    this.prompts = await this.dataSource.query('SELECT "prompt" FROM "prompt_history"');
  }
}

@Module({ imports: [DatabaseModule], providers: [PromptsSeenOnInit] })
class ReaderModule {}

describe('DatabaseModule', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'database-module-'));
    rs.stubEnv('DATA_DIR', dataDir);
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should open DATA_DIR/arc.sqlite in WAL mode with every migration run', async () => {
    const module = await createTestingModule({ imports: [DatabaseModule] }).compile();
    const dataSource = module.get(DataSource);

    expect(existsSync(join(dataDir, 'arc.sqlite'))).toBe(true);
    expect(await dataSource.query('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    expect(await dataSource.query('SELECT "name" FROM "migrations" ORDER BY "id"')).toEqual(DATABASE_MIGRATIONS.map(migration => ({ name: migration.name })));
    await module.close();
  });

  it('should import the legacy files before the modules that read the database start', async () => {
    mkdirSync(join(dataDir, 'web'));
    writeFileSync(join(dataDir, 'web', 'prompt-history.json'), '["imported"]');
    const module = await createTestingModule({ imports: [ReaderModule] }).compile();

    await module.init();

    expect(module.get(PromptsSeenOnInit).prompts).toEqual([{ prompt: 'imported' }]);
    expect(existsSync(join(dataDir, 'web', 'prompt-history.json'))).toBe(false);
    await module.close();
  });

  it('should create with its migrations the schema the entities describe', async () => {
    const dataSource = await createInMemoryDataSource();

    const pending = await dataSource.driver.createSchemaBuilder().log();

    expect(pending.upQueries).toEqual([]);
    await dataSource.destroy();
  });

  it('should revert every migration down to an empty database', async () => {
    const dataSource = await createInMemoryDataSource();

    for (const _migration of DATABASE_MIGRATIONS) {
      await dataSource.undoLastMigration();
    }

    expect(await dataSource.query('SELECT "name" FROM "sqlite_master" WHERE "type" = \'table\' AND "name" NOT IN (\'migrations\', \'sqlite_sequence\')')).toEqual([]);
    await dataSource.destroy();
  });
});
