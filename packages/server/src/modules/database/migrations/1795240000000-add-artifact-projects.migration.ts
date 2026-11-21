import type { MigrationInterface, QueryRunner } from 'typeorm';


const ARTIFACT_COLUMNS = '"conversation_id", "id", "position", "type", "title", "status", "parent_id", "project_name", "assignee_role", '
  + '"assignee_role_name", "assignee_delegation_id", "assignee_since", "branch", "created_at", "updated_at"';

/**
 * A feature links several projects: they move from its `project_name` into `artifact_project`, and `project_name`
 * stays on tasks only. A pull request names the repository it belongs to, inside the project folder of its task.
 *
 * SQLite cannot drop NOT NULL in place, so `artifact` is rebuilt (create, copy, drop, rename). TypeORM turns
 * `foreign_keys` off around the migrations, which is what keeps the drop from cascading into the child tables; the
 * children reference `artifact` by name and keep pointing at the rebuilt table.
 */
export class AddArtifactProjects1795240000000 implements MigrationInterface {
  name = 'AddArtifactProjects1795240000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "artifact_project" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "position" integer NOT NULL, "project_name" text NOT NULL, '
      + 'CONSTRAINT "FK_artifact_project_artifact" FOREIGN KEY ("conversation_id", "artifact_id") REFERENCES "artifact" ("conversation_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("conversation_id", "artifact_id", "position"))',
    );
    await queryRunner.query(
      'INSERT INTO "artifact_project" ("conversation_id", "artifact_id", "position", "project_name") '
      + 'SELECT "conversation_id", "id", 0, "project_name" FROM "artifact" WHERE "type" = \'feature\'',
    );
    await this.rebuildArtifact(
      queryRunner,
      'text',
      ARTIFACT_COLUMNS.replace('"project_name"', 'CASE WHEN "type" = \'feature\' THEN NULL ELSE "project_name" END'),
    );
    await queryRunner.query('ALTER TABLE "artifact_pull_request" ADD COLUMN "repository" text NOT NULL DEFAULT \'.\'');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "artifact_pull_request" DROP COLUMN "repository"');
    await queryRunner.query(
      'UPDATE "artifact" SET "project_name" = (SELECT "project_name" FROM "artifact_project" WHERE "artifact_project"."conversation_id" = "artifact"."conversation_id" '
      + 'AND "artifact_project"."artifact_id" = "artifact"."id" AND "artifact_project"."position" = 0) WHERE "type" = \'feature\'',
    );
    await queryRunner.query('DROP TABLE "artifact_project"');
    await this.rebuildArtifact(queryRunner, 'text NOT NULL', ARTIFACT_COLUMNS);
  }

  /** The `artifact` table as `CreateArtifacts1795190000000` made it, with `project_name` optional or required. */
  private artifactTable(name: string, projectName: 'text' | 'text NOT NULL'): string {
    return `CREATE TABLE "${name}" ("conversation_id" text NOT NULL, "id" text NOT NULL, "position" integer NOT NULL, "type" text NOT NULL, "title" text NOT NULL, `
      + `"status" text NOT NULL, "parent_id" text, "project_name" ${projectName}, "assignee_role" text, "assignee_role_name" text, `
      + '"assignee_delegation_id" text, "assignee_since" text, "branch" text, "created_at" text NOT NULL, "updated_at" text NOT NULL, '
      + 'PRIMARY KEY ("conversation_id", "id"))';
  }

  private async rebuildArtifact(queryRunner: QueryRunner, projectName: 'text' | 'text NOT NULL', selectedColumns: string): Promise<void> {
    await queryRunner.query(this.artifactTable('artifact_rebuilt', projectName));
    await queryRunner.query(`INSERT INTO "artifact_rebuilt" (${ARTIFACT_COLUMNS}) SELECT ${selectedColumns} FROM "artifact"`);
    await queryRunner.query('DROP TABLE "artifact"');
    await queryRunner.query('ALTER TABLE "artifact_rebuilt" RENAME TO "artifact"');
    await queryRunner.query('CREATE INDEX "IDX_artifact_parent" ON "artifact" ("conversation_id", "parent_id")');
    await queryRunner.query('CREATE INDEX "IDX_artifact_status" ON "artifact" ("conversation_id", "status")');
  }
}
