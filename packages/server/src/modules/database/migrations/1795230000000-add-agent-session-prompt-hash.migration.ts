import type { MigrationInterface, QueryRunner } from 'typeorm';


export class AddAgentSessionPromptHash1795230000000 implements MigrationInterface {
  name = 'AddAgentSessionPromptHash1795230000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agent_session" ADD COLUMN "prompt_hash" text');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agent_session" DROP COLUMN "prompt_hash"');
  }
}
