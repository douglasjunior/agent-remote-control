import type { MigrationInterface, QueryRunner } from 'typeorm';


const OWNED_BY_ARTIFACT = 'FOREIGN KEY ("conversation_id", "artifact_id") REFERENCES "artifact" ("conversation_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION';

export class CreateArtifacts1795190000000 implements MigrationInterface {
  name = 'CreateArtifacts1795190000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "artifact" ("conversation_id" text NOT NULL, "id" text NOT NULL, "position" integer NOT NULL, "type" text NOT NULL, "title" text NOT NULL, '
      + '"status" text NOT NULL, "parent_id" text, "project_name" text NOT NULL, "assignee_role" text, "assignee_role_name" text, '
      + '"assignee_delegation_id" text, "assignee_since" text, "branch" text, "created_at" text NOT NULL, "updated_at" text NOT NULL, '
      + 'PRIMARY KEY ("conversation_id", "id"))',
    );
    await queryRunner.query('CREATE INDEX "IDX_artifact_parent" ON "artifact" ("conversation_id", "parent_id")');
    await queryRunner.query('CREATE INDEX "IDX_artifact_status" ON "artifact" ("conversation_id", "status")');
    await queryRunner.query(
      'CREATE TABLE "artifact_refinement" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "kind" text NOT NULL, "state" text NOT NULL, '
      + `CONSTRAINT "FK_artifact_refinement_artifact" ${OWNED_BY_ARTIFACT}, PRIMARY KEY ("conversation_id", "artifact_id", "kind"))`,
    );
    await queryRunner.query(
      'CREATE TABLE "artifact_section" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "section" text NOT NULL, "content" text NOT NULL, '
      + `CONSTRAINT "FK_artifact_section_artifact" ${OWNED_BY_ARTIFACT}, PRIMARY KEY ("conversation_id", "artifact_id", "section"))`,
    );
    await queryRunner.query(
      'CREATE TABLE "artifact_dependency" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "position" integer NOT NULL, "depends_on_id" text NOT NULL, '
      + `CONSTRAINT "FK_artifact_dependency_artifact" ${OWNED_BY_ARTIFACT}, PRIMARY KEY ("conversation_id", "artifact_id", "position"))`,
    );
    await queryRunner.query('CREATE INDEX "IDX_artifact_dependency_depends_on" ON "artifact_dependency" ("conversation_id", "depends_on_id")');
    await queryRunner.query(
      'CREATE TABLE "artifact_pull_request" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "position" integer NOT NULL, "url" text NOT NULL, '
      + '"title" text, "state" text NOT NULL, "added_at" text NOT NULL, '
      + `CONSTRAINT "FK_artifact_pull_request_artifact" ${OWNED_BY_ARTIFACT}, PRIMARY KEY ("conversation_id", "artifact_id", "position"))`,
    );
    await queryRunner.query(
      'CREATE TABLE "artifact_history" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "position" integer NOT NULL, "event_id" text NOT NULL, '
      + '"at" text NOT NULL, "actor_kind" text NOT NULL, "actor_role" text, "actor_role_name" text, "actor_channel" text, "kind" text NOT NULL, '
      + '"summary" text NOT NULL, "text" text, '
      + `CONSTRAINT "FK_artifact_history_artifact" ${OWNED_BY_ARTIFACT}, PRIMARY KEY ("conversation_id", "artifact_id", "position"))`,
    );
    await queryRunner.query(
      'CREATE TABLE "artifact_history_change" ("conversation_id" text NOT NULL, "artifact_id" text NOT NULL, "event_position" integer NOT NULL, '
      + '"position" integer NOT NULL, "field" text NOT NULL, "from_value" text, "to_value" text, '
      + 'CONSTRAINT "FK_artifact_history_change_artifact_history" FOREIGN KEY ("conversation_id", "artifact_id", "event_position") '
      + 'REFERENCES "artifact_history" ("conversation_id", "artifact_id", "position") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("conversation_id", "artifact_id", "event_position", "position"))',
    );
    await queryRunner.query('CREATE TABLE "artifact_counter" ("conversation_id" text NOT NULL, "prefix" text NOT NULL, "value" integer NOT NULL, PRIMARY KEY ("conversation_id", "prefix"))');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "artifact_counter"');
    await queryRunner.query('DROP TABLE "artifact_history_change"');
    await queryRunner.query('DROP TABLE "artifact_history"');
    await queryRunner.query('DROP TABLE "artifact_pull_request"');
    await queryRunner.query('DROP INDEX "IDX_artifact_dependency_depends_on"');
    await queryRunner.query('DROP TABLE "artifact_dependency"');
    await queryRunner.query('DROP TABLE "artifact_section"');
    await queryRunner.query('DROP TABLE "artifact_refinement"');
    await queryRunner.query('DROP INDEX "IDX_artifact_status"');
    await queryRunner.query('DROP INDEX "IDX_artifact_parent"');
    await queryRunner.query('DROP TABLE "artifact"');
  }
}
