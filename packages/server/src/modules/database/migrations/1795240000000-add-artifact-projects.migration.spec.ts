import { DataSource, type QueryRunner } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../constants/database-schema.constant.js';

import { AddArtifactProjects1795240000000 } from './1795240000000-add-artifact-projects.migration.js';


const AT = '2026-01-01T00:00:00.000Z';
const CHILDREN = ['artifact_refinement', 'artifact_section', 'artifact_dependency', 'artifact_pull_request', 'artifact_history'];

describe('AddArtifactProjects1795240000000', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AddArtifactProjects1795240000000();
  const query = <T>(sql: string) => dataSource.query(sql) as Promise<T[]>;

  /** What TypeORM does around a migration: foreign keys off outside the transaction, back on after it. */
  const migrate = async (direction: 'up' | 'down') => {
    await queryRunner.beforeMigration();
    await queryRunner.startTransaction();
    await migration[direction](queryRunner);
    await queryRunner.commitTransaction();
    await queryRunner.afterMigration();
  };

  beforeEach(async () => {
    const earlier = DATABASE_MIGRATIONS.filter(candidate => candidate !== AddArtifactProjects1795240000000);
    dataSource = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: DATABASE_ENTITIES, migrations: earlier, migrationsRun: true }).initialize();
    queryRunner = dataSource.createQueryRunner();
    const artifact = (id: string, type: string, parentId: string | null, projectName: string, position: number) => dataSource.query(
      'INSERT INTO "artifact" ("conversation_id", "id", "position", "type", "title", "status", "parent_id", "project_name", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, \'ready\', ?, ?, ?, ?)',
      ['conv-1', id, position, type, `Title ${id}`, parentId, projectName, AT, AT],
    );
    await artifact('F-1', 'feature', null, 'shop', 0);
    await artifact('T-1', 'task', 'F-1', 'shop', 1);
    await artifact('T-2', 'task', null, 'blog', 2);
    await dataSource.query('INSERT INTO "artifact_counter" ("conversation_id", "prefix", "value") VALUES (\'conv-1\', \'T\', 2)');
    for (const id of ['F-1', 'T-1']) {
      await dataSource.query('INSERT INTO "artifact_refinement" ("conversation_id", "artifact_id", "kind", "state") VALUES (\'conv-1\', ?, \'business\', \'done\')', [id]);
      await dataSource.query('INSERT INTO "artifact_section" ("conversation_id", "artifact_id", "section", "content") VALUES (\'conv-1\', ?, \'overview\', \'Text\')', [id]);
    }
    await dataSource.query('INSERT INTO "artifact_dependency" ("conversation_id", "artifact_id", "position", "depends_on_id") VALUES (\'conv-1\', \'T-1\', 0, \'T-0\')');
    await dataSource.query(
      'INSERT INTO "artifact_pull_request" ("conversation_id", "artifact_id", "position", "url", "state", "added_at") VALUES (\'conv-1\', \'T-1\', 0, \'https://example.com/pr/1\', \'open\', ?)',
      [AT],
    );
    await dataSource.query(
      'INSERT INTO "artifact_history" ("conversation_id", "artifact_id", "position", "event_id", "at", "actor_kind", "kind", "summary") VALUES (\'conv-1\', \'T-1\', 0, \'e-1\', ?, \'system\', \'created\', \'Created\')',
      [AT],
    );
    await dataSource.query(
      'INSERT INTO "artifact_history_change" ("conversation_id", "artifact_id", "event_position", "position", "field") VALUES (\'conv-1\', \'T-1\', 0, 0, \'status\')',
    );
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  describe('up', () => {
    beforeEach(() => migrate('up'));

    it('should move the project of each feature into artifact_project and leave the tasks as they were', async () => {
      expect(await query('SELECT "conversation_id", "artifact_id", "position", "project_name" FROM "artifact_project"')).toEqual([{ conversation_id: 'conv-1', artifact_id: 'F-1', position: 0, project_name: 'shop' }]);
      expect(await query('SELECT "id", "type", "project_name", "parent_id", "position", "title" FROM "artifact" ORDER BY "position"')).toEqual([
        { id: 'F-1', type: 'feature', project_name: null, parent_id: null, position: 0, title: 'Title F-1' },
        { id: 'T-1', type: 'task', project_name: 'shop', parent_id: 'F-1', position: 1, title: 'Title T-1' },
        { id: 'T-2', type: 'task', project_name: 'blog', parent_id: null, position: 2, title: 'Title T-2' },
      ]);
    });

    it('should keep every row of the child tables, the indexes and the foreign keys pointing at artifact', async () => {
      const counts = await Promise.all(CHILDREN.map(async table => (await query<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "${table}"`))[0]!.total));
      expect(counts).toEqual([2, 2, 1, 1, 1]);
      expect(await query('SELECT COUNT(*) AS "total" FROM "artifact_history_change"')).toEqual([{ total: 1 }]);
      expect(await query('SELECT "value" FROM "artifact_counter"')).toEqual([{ value: 2 }]);
      expect((await query<{ name: string }>('SELECT "name" FROM "sqlite_master" WHERE "type" = \'index\' AND "tbl_name" = \'artifact\' AND "name" LIKE \'IDX_%\' ORDER BY "name"')).map(row => row.name))
        .toEqual(['IDX_artifact_parent', 'IDX_artifact_status']);
      for (const table of [...CHILDREN, 'artifact_project']) {
        expect([...new Set((await query<{ table: string }>(`PRAGMA foreign_key_list("${table}")`)).map(key => key.table))]).toEqual(['artifact']);
      }
      expect(await query('PRAGMA foreign_key_check')).toEqual([]);
    });

    it('should keep the cascade from the rebuilt artifact table', async () => {
      await dataSource.query('DELETE FROM "artifact" WHERE "id" = \'F-1\'');

      expect(await query('SELECT COUNT(*) AS "total" FROM "artifact_project"')).toEqual([{ total: 0 }]);
      expect(await query('SELECT "artifact_id" FROM "artifact_section"')).toEqual([{ artifact_id: 'T-1' }]);
    });

    it('should link the stored pull requests to the project folder itself', async () => {
      expect(await query('SELECT "url", "repository" FROM "artifact_pull_request"')).toEqual([{ url: 'https://example.com/pr/1', repository: '.' }]);
    });

    it('should make project_name optional', async () => {
      const column = (await query<{ name: string; notnull: number }>('PRAGMA table_info("artifact")')).find(candidate => candidate.name === 'project_name');

      expect(column?.notnull).toBe(0);
    });
  });

  describe('down', () => {
    beforeEach(async () => {
      await migrate('up');
      await dataSource.query('INSERT INTO "artifact_project" ("conversation_id", "artifact_id", "position", "project_name") VALUES (\'conv-1\', \'F-1\', 1, \'blog\')');
      await migrate('down');
    });

    it('should give each feature back the first of its projects and drop the new table and column', async () => {
      expect(await query('SELECT "id", "project_name" FROM "artifact" ORDER BY "position"')).toEqual([
        { id: 'F-1', project_name: 'shop' },
        { id: 'T-1', project_name: 'shop' },
        { id: 'T-2', project_name: 'blog' },
      ]);
      expect(await query('SELECT "name" FROM "sqlite_master" WHERE "name" = \'artifact_project\'')).toEqual([]);
      expect((await query<{ name: string }>('PRAGMA table_info("artifact_pull_request")')).map(column => column.name)).not.toContain('repository');
    });

    it('should require project_name again and keep the child rows, indexes and foreign keys', async () => {
      const column = (await query<{ name: string; notnull: number }>('PRAGMA table_info("artifact")')).find(candidate => candidate.name === 'project_name');
      const counts = await Promise.all(CHILDREN.map(async table => (await query<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "${table}"`))[0]!.total));

      expect(column?.notnull).toBe(1);
      expect(counts).toEqual([2, 2, 1, 1, 1]);
      expect(await query('SELECT COUNT(*) AS "total" FROM "artifact_history_change"')).toEqual([{ total: 1 }]);
      expect((await query<{ name: string }>('SELECT "name" FROM "sqlite_master" WHERE "type" = \'index\' AND "tbl_name" = \'artifact\' AND "name" LIKE \'IDX_%\' ORDER BY "name"')).map(row => row.name))
        .toEqual(['IDX_artifact_parent', 'IDX_artifact_status']);
      expect(await query('PRAGMA foreign_key_check')).toEqual([]);
    });
  });
});
