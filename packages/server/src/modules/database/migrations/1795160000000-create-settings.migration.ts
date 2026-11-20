import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateSettings1795160000000 implements MigrationInterface {
  name = 'CreateSettings1795160000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "setting" ("key" text PRIMARY KEY NOT NULL, "value" text NOT NULL, "updated_at" text NOT NULL)');
    await queryRunner.query('CREATE TABLE "preferences" ("id" integer PRIMARY KEY NOT NULL, "language" text, "updated_at" text)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "preferences"');
    await queryRunner.query('DROP TABLE "setting"');
  }
}
