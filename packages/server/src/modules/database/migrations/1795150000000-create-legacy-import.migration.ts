import type { MigrationInterface, QueryRunner } from 'typeorm';


export class CreateLegacyImport1795150000000 implements MigrationInterface {
  name = 'CreateLegacyImport1795150000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE "legacy_import" ("importer" text PRIMARY KEY NOT NULL, "imported_at" text NOT NULL, "counts" text NOT NULL)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "legacy_import"');
  }
}
