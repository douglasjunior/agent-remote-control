import type { MigrationInterface, QueryRunner } from 'typeorm';


export class AddOpenWorkUpdates1795220000000 implements MigrationInterface {
  name = 'AddOpenWorkUpdates1795220000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "open_work" ADD COLUMN "updates" text');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "open_work" DROP COLUMN "updates"');
  }
}
