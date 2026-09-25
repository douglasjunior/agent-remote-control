import type { AgentDefinition } from '../models/agent-definition.model.js';
import { CEO_SYSTEM_PROMPT } from '../prompts/ceo.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT } from '../prompts/developer.prompt.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO / Router Agent',
    description:
      'Executive agent specialized in triage, project orchestration, requirements scoping, and routing implementation tasks to the Developer Agent.',
    systemPrompt: CEO_SYSTEM_PROMPT,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    description:
      'Senior software engineer specialized in codebase analysis, architectural design, implementation, automated tests, Git operations, and refactoring.',
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
  },
] as const;
