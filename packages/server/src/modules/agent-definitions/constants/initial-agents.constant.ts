import type { AgentDefinition } from '../models/agent-definition.model.js';
import { buildCeoSystemPrompt } from '../prompts/ceo.prompt.js';
import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  CODE_REVIEWER_TURN_REMINDER,
} from '../prompts/code-reviewer.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from '../prompts/developer.prompt.js';
import { GIT_OPS_SYSTEM_PROMPT, GIT_OPS_TURN_REMINDER } from '../prompts/git-ops.prompt.js';
import { PRODUCT_OWNER_SYSTEM_PROMPT, PRODUCT_OWNER_TURN_REMINDER } from '../prompts/product-owner.prompt.js';
import { QA_SYSTEM_PROMPT, QA_TURN_REMINDER } from '../prompts/qa.prompt.js';
import { TECH_LEAD_SYSTEM_PROMPT, TECH_LEAD_TURN_REMINDER } from '../prompts/tech-lead.prompt.js';

import {
  CEO_ARTIFACT_ACCESS,
  CODE_REVIEWER_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
  QA_ARTIFACT_ACCESS,
  TECH_LEAD_ARTIFACT_ACCESS,
} from './artifact-access.constant.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO',
    description:
      'Leads the agent team: talks with the user, scopes requests, delegates all hands-on work, and reviews results.',
    buildSystemPrompt: buildCeoSystemPrompt,
    systemPromptEveryTurn: true,
    delegation: {},
    artifacts: CEO_ARTIFACT_ACCESS,
    writesSkills: true,
  },
  {
    role: 'GIT_OPS',
    name: 'Git Ops Agent',
    description:
      'Owns ad-hoc Git operations that reach a remote: adding a repository to the workspace by cloning or initializing it, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests, and SSH key setup. It does not run project scripts, even when they clone or fetch internally. Keeps the mapping from repository URL to project folder, so it also answers whether a repository is already in the workspace and under which folder. Delegate to it without a project folder to add or locate a repository, stating the full repository URL in the specification; it answers with the project folder it used, which is the folder the follow-up work belongs to. Delegate to it with a project folder for remote operations on a repository already there, or with a task to push its branch and open, update or merge its pull request, which it links on the task.',
    buildSystemPrompt: () => GIT_OPS_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'optional', sessionMode: 'overridable', artifact: 'optional' },
    artifacts: GIT_OPS_ARTIFACT_ACCESS,
    turnReminder: GIT_OPS_TURN_REMINDER,
  },
  {
    role: 'PRODUCT_OWNER',
    name: 'Product Owner Agent',
    description:
      'Product discovery before any technical planning: requirements, business rules, exploration of ideas and features, flows, usability, and acceptance criteria. Delegate to it whenever a request is about what to build or why rather than how, or is too vague to plan, before the Tech Lead. It interviews the user directly, round after round, until no loose end is left, and consolidates the intent on the board: a feature broken into tasks, or the task it was given, with their business sections (overview, user stories, rules, flows, acceptance criteria, test cases) and business refinement done. It answers with the ids it created or changed plus the technical decisions it left for the technical team. Delegate to it with the artifact to refine, or with a project folder for a new initiative; it reads the code and documentation of that project for context. Resume it to refine what it delivered; start a new session for a new subject.',
    buildSystemPrompt: () => PRODUCT_OWNER_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional' },
    artifacts: PRODUCT_OWNER_ARTIFACT_ACCESS,
    turnReminder: PRODUCT_OWNER_TURN_REMINDER,
  },
  {
    role: 'TECH_LEAD',
    name: 'Tech Lead Agent',
    description:
      'Senior technical lead and software architect for technical planning, architecture analysis, investigations, trade-off evaluations, impact assessment, and task decomposition before implementation. Aligns on critical technical decisions with the user and refines the board technically: the technical solution of each task (affected files, steps, tests, verification) and the split of large work into dependent tasks, answering with the ids it created or changed plus a summary. Delegate to it with the task or feature to refine, or with a project folder for an investigation. Resume it to refine what it delivered.',
    buildSystemPrompt: () => TECH_LEAD_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional' },
    artifacts: TECH_LEAD_ARTIFACT_ACCESS,
    turnReminder: TECH_LEAD_TURN_REMINDER,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    description:
      'Senior software engineer that implements a task of the board inside its project: implementation, refactoring, bug fixing, automated tests, and local Git work such as inspecting the working tree, creating local branches, and committing its own changes. It also runs the commands a project documents for itself, such as package.json scripts, Makefile targets, and setup or init scripts described in README or AGENTS.md, even when they install dependencies or clone sub-repositories. It works only in a project folder that already holds the repository, and it does not run ad-hoc Git operations against remotes, so a repository still absent from the workspace has to be added before delegating to it. It records the branch and implementation notes on the task. Resume it to fix the review findings of the same task.',
    buildSystemPrompt: () => DEVELOPER_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'required', sessionMode: 'overridable', artifact: 'required' },
    artifacts: DEVELOPER_ARTIFACT_ACCESS,
    turnReminder: DEVELOPER_TURN_REMINDER,
  },
  {
    role: 'CODE_REVIEWER',
    name: 'Code Reviewer Agent',
    description:
      'Senior code reviewer for rigorous, unbiased review of the work on a task: its open pull request, or its branch reviewed locally when there is none. It judges the change against the task, the project conventions, security checklists, and functional correctness, and never runs the project or its tests: it reads the results of the pull request pipeline. It records its findings on the task, publishes them on the pull request when there is one, and answers with the verdict, APPROVED or CHANGES_REQUESTED. Reviews in a fresh session to avoid prior implementation bias.',
    buildSystemPrompt: () => CODE_REVIEWER_SYSTEM_PROMPT,
    defaultSessionMode: 'new',
    delegation: { project: 'required', sessionMode: 'overridable', readOnly: true, artifact: 'required', needsReviewableWork: true },
    artifacts: CODE_REVIEWER_ARTIFACT_ACCESS,
    turnReminder: CODE_REVIEWER_TURN_REMINDER,
  },
  {
    role: 'QA',
    name: 'QA Agent',
    description:
      'Quality analyst that tests the work on a task in practice, after its review: it runs the application from the task\'s branch and exercises the acceptance criteria and test cases as a user or client would, with Playwright for web interfaces and HTTP APIs and mobile-mcp for mobile apps. It never changes code or commits, and leaves the project as it found it. It records the test report on the task and answers with the verdict, PASSED or FAILED. Resume it to test the same task again after a fix.',
    buildSystemPrompt: () => QA_SYSTEM_PROMPT,
    defaultSessionMode: 'resume',
    delegation: { project: 'required', sessionMode: 'overridable', artifact: 'required', needsReviewableWork: true },
    artifacts: QA_ARTIFACT_ACCESS,
    turnReminder: QA_TURN_REMINDER,
  },
];
