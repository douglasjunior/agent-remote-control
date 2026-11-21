import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateSessions1795200000000 implements MigrationInterface {
  name = 'CreateSessions1795200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "session" ("conversation_id" text PRIMARY KEY NOT NULL)');
    await queryRunner.query(
      'CREATE TABLE "agent_session" ("conversation_id" text NOT NULL, "position" integer NOT NULL, "role" text NOT NULL, "agent_id" text NOT NULL, '
      + '"session_id" text NOT NULL, "project_name" text, "artifact_id" text, "work_ended_at" text, "unanswered" boolean, '
      + 'CONSTRAINT "FK_agent_session_session" FOREIGN KEY ("conversation_id") REFERENCES "session" ("conversation_id") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("conversation_id", "position"))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_session"');
    await queryRunner.query('DROP TABLE "session"');
  }
}
