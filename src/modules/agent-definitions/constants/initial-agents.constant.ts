import type { AgentDefinition } from '../models/agent-definition.model.js';
import { buildCeoSystemPrompt } from '../prompts/ceo.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT } from '../prompts/developer.prompt.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO',
    description:
      'Leads the agent team: talks with the user, scopes requests, delegates all hands-on work, and reviews results.',
    buildSystemPrompt: buildCeoSystemPrompt,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    description:
      'Senior software engineer for any hands-on technical work in a project folder: cloning and setting up repositories, codebase analysis, implementation, refactoring, bug fixing, automated tests, and Git operations.',
    buildSystemPrompt: () => DEVELOPER_SYSTEM_PROMPT,
  },
];
