import type { MigrationInterface, QueryRunner } from 'typeorm';


const FEATURE_SESSIONS = 'FROM "artifact" WHERE "artifact"."conversation_id" = "agent_session"."conversation_id" AND "artifact"."id" = "agent_session"."artifact_id" AND "artifact"."type" = \'feature\'';

/**
 * The agent of a feature works from the workspaces root, so its session is keyed without a project, like any other
 * work at the root. A session stored under the feature's first project, where its agent used to run, takes that key and
 * the agent resumes it.
 */
export class KeyFeatureSessionsToRoot1795250000000 implements MigrationInterface {
  name = 'KeyFeatureSessionsToRoot1795250000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "agent_session" SET "project_name" = NULL WHERE EXISTS (SELECT 1 ${FEATURE_SESSIONS})`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'UPDATE "agent_session" SET "project_name" = (SELECT "artifact_project"."project_name" FROM "artifact_project" WHERE "artifact_project"."conversation_id" = "agent_session"."conversation_id" '
      + 'AND "artifact_project"."artifact_id" = "agent_session"."artifact_id" AND "artifact_project"."position" = 0) '
      + `WHERE "project_name" IS NULL AND EXISTS (SELECT 1 ${FEATURE_SESSIONS})`,
    );
  }
}
