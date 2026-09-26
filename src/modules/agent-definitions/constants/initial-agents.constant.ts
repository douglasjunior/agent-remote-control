import type { AgentDefinition } from '../models/agent-definition.model.js';
import { buildCeoSystemPrompt, CEO_TURN_REMINDER } from '../prompts/ceo.prompt.js';
import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  CODE_REVIEWER_TURN_REMINDER,
} from '../prompts/code-reviewer.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from '../prompts/developer.prompt.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO',
    description:
      'Leads the agent team: talks with the user, scopes requests, delegates all hands-on work, and reviews results.',
    buildSystemPrompt: buildCeoSystemPrompt,
    turnReminder: CEO_TURN_REMINDER,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    description:
      'Senior software engineer for any hands-on technical work in a project folder: cloning and setting up repositories, codebase analysis, planning, implementation, refactoring, bug fixing, automated tests, and Git operations.',
    buildSystemPrompt: () => DEVELOPER_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    turnReminder: DEVELOPER_TURN_REMINDER,
  },
  {
    role: 'CODE_REVIEWER',
    name: 'Code Reviewer Agent',
    description:
      'Senior code reviewer for rigorous, unbiased inspection of diffs, branches, pull requests, and codebases against project conventions, security checklists, and functional correctness. Operates in a fresh session without prior implementation bias.',
    buildSystemPrompt: () => CODE_REVIEWER_SYSTEM_PROMPT,
    defaultSessionMode: 'new',
    turnReminder: CODE_REVIEWER_TURN_REMINDER,
  },
];
