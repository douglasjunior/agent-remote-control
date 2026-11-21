import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../constants/database-schema.constant.js';

import { AddAgentSessionPromptHash1795230000000 } from './1795230000000-add-agent-session-prompt-hash.migration.js';


describe('AddAgentSessionPromptHash1795230000000', () => {
  let dataSource: DataSource;
  const migration = new AddAgentSessionPromptHash1795230000000();
  const columns = async () => (await dataSource.query('PRAGMA table_info("agent_session")') as { name: string }[]).map(column => column.name);

  beforeEach(async () => {
    const earlier = DATABASE_MIGRATIONS.filter(candidate => candidate !== AddAgentSessionPromptHash1795230000000);
    dataSource = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: DATABASE_ENTITIES, migrations: earlier, migrationsRun: true }).initialize();
    await dataSource.query('INSERT INTO "session" ("conversation_id") VALUES (\'conv-1\')');
    await dataSource.query('INSERT INTO "agent_session" ("conversation_id", "position", "role", "agent_id", "session_id") VALUES (\'conv-1\', 0, \'CEO\', \'claude\', \'s-1\')');
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('should add a nullable column that leaves the stored sessions without a fingerprint', async () => {
    const queryRunner = dataSource.createQueryRunner();

    await migration.up(queryRunner);

    expect(await columns()).toContain('prompt_hash');
    expect(await dataSource.query('SELECT "session_id", "prompt_hash" FROM "agent_session"')).toEqual([{ session_id: 's-1', prompt_hash: null }]);
    await queryRunner.release();
  });

  it('should drop the column again and keep the stored sessions', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await migration.up(queryRunner);

    await migration.down(queryRunner);

    expect(await columns()).not.toContain('prompt_hash');
    expect(await dataSource.query('SELECT "session_id" FROM "agent_session"')).toEqual([{ session_id: 's-1' }]);
    await queryRunner.release();
  });
});
