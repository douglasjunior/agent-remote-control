import { DataSource, type QueryRunner } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../constants/database-schema.constant.js';

import { KeyFeatureSessionsToRoot1795250000000 } from './1795250000000-key-feature-sessions-to-root.migration.js';


const AT = '2026-01-01T00:00:00.000Z';

describe('KeyFeatureSessionsToRoot1795250000000', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new KeyFeatureSessionsToRoot1795250000000();
  const sessions = () => dataSource.query('SELECT "session_id" AS "sessionId", "project_name" AS "projectName" FROM "agent_session" ORDER BY "session_id"') as Promise<{ sessionId: string; projectName: string | null }[]>;

  beforeEach(async () => {
    const earlier = DATABASE_MIGRATIONS.filter(candidate => candidate !== KeyFeatureSessionsToRoot1795250000000);
    dataSource = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: DATABASE_ENTITIES, migrations: earlier, migrationsRun: true }).initialize();
    queryRunner = dataSource.createQueryRunner();
    await dataSource.query('INSERT INTO "session" ("conversation_id") VALUES (\'conv-1\')');
    await dataSource.query('INSERT INTO "session" ("conversation_id") VALUES (\'conv-2\')');
    const artifact = (conversationId: string, id: string, type: string, projectName: string | null, position: number) => dataSource.query(
      'INSERT INTO "artifact" ("conversation_id", "id", "position", "type", "title", "status", "project_name", "created_at", "updated_at") VALUES (?, ?, ?, ?, \'Title\', \'ready\', ?, ?, ?)',
      [conversationId, id, position, type, projectName, AT, AT],
    );
    await artifact('conv-1', 'F-1', 'feature', null, 0);
    await artifact('conv-1', 'T-1', 'task', 'shop', 1);
    await artifact('conv-2', 'T-1', 'task', 'shop', 0);
    await dataSource.query('INSERT INTO "artifact_project" ("conversation_id", "artifact_id", "position", "project_name") VALUES (\'conv-1\', \'F-1\', 0, \'shop\'), (\'conv-1\', \'F-1\', 1, \'api\')');
    const session = (conversationId: string, position: number, sessionId: string, projectName: string | null, artifactId: string | null) => dataSource.query(
      'INSERT INTO "agent_session" ("conversation_id", "position", "role", "agent_id", "session_id", "project_name", "artifact_id") VALUES (?, ?, \'TECH_LEAD\', \'claude\', ?, ?, ?)',
      [conversationId, position, sessionId, projectName, artifactId],
    );
    await session('conv-1', 0, 'feature', 'shop', 'F-1');
    await session('conv-1', 1, 'task', 'shop', 'T-1');
    await session('conv-1', 2, 'project', 'shop', null);
    await session('conv-2', 0, 'other-conversation', 'shop', 'T-1');
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  it('should take the project off the sessions of features only', async () => {
    await migration.up(queryRunner);

    expect(await sessions()).toEqual([
      { sessionId: 'feature', projectName: null },
      { sessionId: 'other-conversation', projectName: 'shop' },
      { sessionId: 'project', projectName: 'shop' },
      { sessionId: 'task', projectName: 'shop' },
    ]);
  });

  it('should give the sessions of features the first project of the feature again', async () => {
    await migration.up(queryRunner);

    await migration.down(queryRunner);

    expect(await sessions()).toEqual([
      { sessionId: 'feature', projectName: 'shop' },
      { sessionId: 'other-conversation', projectName: 'shop' },
      { sessionId: 'project', projectName: 'shop' },
      { sessionId: 'task', projectName: 'shop' },
    ]);
  });
});
