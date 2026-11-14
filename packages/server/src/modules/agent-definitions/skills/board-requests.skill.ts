import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { buildArtifactProtocolBody } from '../prompts/artifact-protocol.prompt.js';


/** The board protocol of the system prompt, built for the reader's access, for an agent whose session lost it. */
export const BOARD_REQUESTS_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.boardRequests,
  description: 'The board of the conversation and the requests you read and change it with, written for your role: what an artifact holds, the request grammar, and the sections and fields you may write. Read it whenever that grammar is no longer in front of you, before writing an artifact request.',
  roles: ['GIT_OPS', 'PRODUCT_OWNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'QA'],
  buildContent: ({ artifacts }) => `# Board Requests\n\n${buildArtifactProtocolBody(artifacts)}`,
};
