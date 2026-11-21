import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateWebHistory1795150145081 implements MigrationInterface {
  name = 'CreateWebHistory1795150145081';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "conversation" ("id" text PRIMARY KEY NOT NULL, "title" text NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, "archived_at" text)');
    await queryRunner.query('CREATE INDEX "IDX_conversation_updated_at" ON "conversation" ("updated_at")');
    await queryRunner.query(
      'CREATE TABLE "conversation_entry" ("conversation_id" text NOT NULL, "entry_id" text NOT NULL, "position" integer NOT NULL, '
      + '"at" text NOT NULL, "type" text NOT NULL, "payload" text NOT NULL, '
      + 'CONSTRAINT "FK_conversation_entry_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, '
      + 'PRIMARY KEY ("conversation_id", "entry_id"))',
    );
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_conversation_entry_position" ON "conversation_entry" ("conversation_id", "position")');
    await queryRunner.query('CREATE TABLE "prompt_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "prompt" text NOT NULL)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "prompt_history"');
    await queryRunner.query('DROP INDEX "IDX_conversation_entry_position"');
    await queryRunner.query('DROP TABLE "conversation_entry"');
    await queryRunner.query('DROP INDEX "IDX_conversation_updated_at"');
    await queryRunner.query('DROP TABLE "conversation"');
  }
}
