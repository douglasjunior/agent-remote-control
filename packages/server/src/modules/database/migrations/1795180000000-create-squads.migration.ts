import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateSquads1795180000000 implements MigrationInterface {
  name = 'CreateSquads1795180000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "squad" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "description" text, "is_default" boolean NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL)');
    await queryRunner.query(
      'CREATE TABLE "squad_profile" ("squad_id" text NOT NULL, "role" text NOT NULL, "agent_id" text NOT NULL, "agent_name" text NOT NULL, '
      + '"model_id" text, "model_name" text, "effort_id" text, "effort_name" text, '
      + 'CONSTRAINT "FK_squad_profile_squad" FOREIGN KEY ("squad_id") REFERENCES "squad" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("squad_id", "role"))',
    );
    // Added in place: rebuilding the table would drop it, and its profiles with it through the cascade.
    await queryRunner.query('ALTER TABLE "agent_settings" ADD COLUMN "applied_squad_id" text');
    await queryRunner.query('ALTER TABLE "agent_settings" ADD COLUMN "applied_squad_name" text');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agent_settings" DROP COLUMN "applied_squad_name"');
    await queryRunner.query('ALTER TABLE "agent_settings" DROP COLUMN "applied_squad_id"');
    await queryRunner.query('DROP TABLE "squad_profile"');
    await queryRunner.query('DROP TABLE "squad"');
  }
}
