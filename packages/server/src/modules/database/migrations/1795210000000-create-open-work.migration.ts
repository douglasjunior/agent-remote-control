import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateOpenWork1795210000000 implements MigrationInterface {
  name = 'CreateOpenWork1795210000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "open_work" ("conversation_id" text NOT NULL, "id" text NOT NULL, "position" integer NOT NULL, "role" text NOT NULL, "role_name" text NOT NULL, '
      + '"project_name" text, "artifact_id" text, "summary" text NOT NULL, "task_spec" text NOT NULL, "cwd" text NOT NULL, "round" integer NOT NULL, '
      + '"root" boolean NOT NULL, "questions" text, PRIMARY KEY ("conversation_id", "id"))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "open_work"');
  }
}
