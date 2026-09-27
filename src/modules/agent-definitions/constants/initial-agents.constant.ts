import type { AgentDefinition } from '../models/agent-definition.model.js';
import { buildCeoSystemPrompt, CEO_TURN_REMINDER } from '../prompts/ceo.prompt.js';
import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  CODE_REVIEWER_TURN_REMINDER,
} from '../prompts/code-reviewer.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from '../prompts/developer.prompt.js';
import { GIT_OPS_SYSTEM_PROMPT, GIT_OPS_TURN_REMINDER } from '../prompts/git-ops.prompt.js';
import { TECH_LEAD_SYSTEM_PROMPT, TECH_LEAD_TURN_REMINDER } from '../prompts/tech-lead.prompt.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO',
    description:
      'Leads the agent team: talks with the user, scopes requests, delegates all hands-on work, and reviews results.',
    buildSystemPrompt: buildCeoSystemPrompt,
    delegation: {},
    turnReminder: CEO_TURN_REMINDER,
  },
  {
    role: 'GIT_OPS',
    name: 'Git Ops Agent',
    description:
      'Owns ad-hoc Git operations that reach a remote: adding a repository to the workspace by cloning or initializing it, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests, and SSH key setup. It does not run project scripts, even when they clone or fetch internally. Keeps the mapping from repository URL to project folder, so it also answers whether a repository is already in the workspace and under which folder. Delegate to it without a project folder to add or locate a repository, stating the full repository URL in the specification; it answers with the project folder it used, which is the folder the follow-up work belongs to. Delegate to it with a project folder for remote operations on a repository already there.',
    buildSystemPrompt: () => GIT_OPS_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'optional', sessionMode: 'overridable' },
    turnReminder: GIT_OPS_TURN_REMINDER,
  },
  {
    role: 'TECH_LEAD',
    name: 'Tech Lead Agent',
    description:
      'Senior technical lead and software architect for technical planning, architecture analysis, investigations, trade-off evaluations, impact assessment, and task decomposition before implementation. Aligns on critical technical decisions and produces actionable plans for the Developer.',
    buildSystemPrompt: () => TECH_LEAD_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'optional', sessionMode: 'overridable' },
    turnReminder: TECH_LEAD_TURN_REMINDER,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    description:
      'Senior software engineer for hands-on technical execution inside a project folder: implementation, refactoring, bug fixing, automated tests, and local Git work such as inspecting the working tree, creating local branches, and committing its own changes. It also runs the commands a project documents for itself, such as package.json scripts, Makefile targets, and setup or init scripts described in README or AGENTS.md, even when they install dependencies or clone sub-repositories. It works only in a project folder that already holds the repository, and it does not run ad-hoc Git operations against remotes, so a repository still absent from the workspace has to be added before delegating to it.',
    buildSystemPrompt: () => DEVELOPER_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'required', sessionMode: 'overridable' },
    turnReminder: DEVELOPER_TURN_REMINDER,
  },
  {
    role: 'CODE_REVIEWER',
    name: 'Code Reviewer Agent',
    description:
      'Senior code reviewer for rigorous, unbiased inspection of diffs, branches, pull requests, and codebases against project conventions, security checklists, and functional correctness, publishing review comments on PRs/MRs when requested. Reviews in a fresh session to avoid prior implementation bias; to publish findings it already mapped, delegate again with :resume so it reuses that inspection context.',
    buildSystemPrompt: () => CODE_REVIEWER_SYSTEM_PROMPT,
    defaultSessionMode: 'new',
    delegation: { project: 'required', sessionMode: 'overridable' },
    turnReminder: CODE_REVIEWER_TURN_REMINDER,
  },
];
