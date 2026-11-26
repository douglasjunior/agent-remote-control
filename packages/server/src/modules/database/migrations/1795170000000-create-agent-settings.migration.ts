import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateAgentSettings1795170000000 implements MigrationInterface {
  name = 'CreateAgentSettings1795170000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "agent_settings" ("conversation_id" text PRIMARY KEY NOT NULL, "updated_at" text NOT NULL)');
    await queryRunner.query('CREATE INDEX "IDX_agent_settings_updated_at" ON "agent_settings" ("updated_at")');
    await queryRunner.query(
      'CREATE TABLE "agent_profile" ("conversation_id" text NOT NULL, "role" text NOT NULL, "agent_id" text NOT NULL, "agent_name" text NOT NULL, '
      + '"model_id" text, "model_name" text, "effort_id" text, "effort_name" text, '
      + 'CONSTRAINT "FK_agent_profile_agent_settings" FOREIGN KEY ("conversation_id") REFERENCES "agent_settings" ("conversation_id") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("conversation_id", "role"))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_profile"');
    await queryRunner.query('DROP INDEX "IDX_agent_settings_updated_at"');
    await queryRunner.query('DROP TABLE "agent_settings"');
  }
}
