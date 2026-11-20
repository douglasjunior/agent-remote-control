import type { AgentDefinition } from '../models/agent-definition.model.js';
import { buildCeoSystemPrompt } from '../prompts/ceo.prompt.js';
import { CODE_REVIEWER_REENTRY_NOTE, CODE_REVIEWER_SYSTEM_PROMPT } from '../prompts/code-reviewer.prompt.js';
import { DEVELOPER_REENTRY_NOTE, DEVELOPER_SYSTEM_PROMPT } from '../prompts/developer.prompt.js';
import { GIT_OPS_REENTRY_NOTE, GIT_OPS_SYSTEM_PROMPT } from '../prompts/git-ops.prompt.js';
import { IT_SUPPORT_REENTRY_NOTE, IT_SUPPORT_SYSTEM_PROMPT } from '../prompts/it-support.prompt.js';
import { PRODUCT_OWNER_REENTRY_NOTE, PRODUCT_OWNER_SYSTEM_PROMPT } from '../prompts/product-owner.prompt.js';
import { QA_REENTRY_NOTE, QA_SYSTEM_PROMPT } from '../prompts/qa.prompt.js';
import { TECH_LEAD_REENTRY_NOTE, TECH_LEAD_SYSTEM_PROMPT } from '../prompts/tech-lead.prompt.js';

import {
  CEO_ARTIFACT_ACCESS,
  CODE_REVIEWER_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  IT_SUPPORT_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
  QA_ARTIFACT_ACCESS,
  TECH_LEAD_ARTIFACT_ACCESS,
} from './artifact-access.constant.js';


export const INITIAL_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    role: 'CEO',
    name: 'CEO',
    summary: 'Talks with the user and coordinates the team.',
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
    summary: 'Repository administration: adds a repository to the workspace, syncs and merges branches, merges pull requests, and runs destructive Git operations on explicit instruction.',
    description:
      'Repository administration. Adds a repository to the workspace by cloning or initializing it, and keeps the mapping from repository URL to project folder, so it also answers whether a repository is already in the workspace and under which folder. Syncs and integrates branches against a remote (fetch, pull, merge, rebase), merges pull requests, configures remotes, sets up SSH keys, and runs the operations that can destroy work (force push, deleting remote refs, discarding commits) on an instruction that names the operation and its target. It does not write code, run project scripts, or push and open the pull request of a task: the agent that implements does that for its own task. Delegate to it without a project folder to add or locate a repository, stating the full repository URL and the transport the user asked for, if any; it answers with the project folder it used, which is the folder the follow-up work belongs to. Delegate to it with a project folder for remote operations on a repository already there, or with a task to merge its pull request, which it updates on the task.',
    buildSystemPrompt: () => GIT_OPS_SYSTEM_PROMPT,
    delegation: { project: 'optional', sessionMode: 'overridable', artifact: 'optional' },
    artifacts: GIT_OPS_ARTIFACT_ACCESS,
    reentryNote: GIT_OPS_REENTRY_NOTE,
  },
  {
    role: 'PRODUCT_OWNER',
    name: 'Product Owner Agent',
    summary: 'Product discovery with the user: what to build and why, consolidated on the board as a feature and its tasks.',
    description:
      'Product discovery before any technical planning: requirements, business rules, exploration of ideas and features, flows, usability, and acceptance criteria. Delegate to it whenever a request is about what to build or why rather than how, or is too vague to plan, before the Tech Lead. It interviews the user directly, round after round, until no loose end is left, and consolidates the intent on the board: a feature broken into tasks, or the task it was given, with their business sections (overview, user stories, rules, flows, acceptance criteria, test cases) and business refinement done. It answers with the ids it created or changed plus the technical decisions it left for the technical team. Delegate to it with the artifact to refine, or with a project folder for a new initiative; it reads the code and documentation of that project for context.',
    buildSystemPrompt: () => PRODUCT_OWNER_SYSTEM_PROMPT,
    delegation: { project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional', asksUser: true, refines: 'business' },
    artifacts: PRODUCT_OWNER_ARTIFACT_ACCESS,
    reentryNote: PRODUCT_OWNER_REENTRY_NOTE,
  },
  {
    role: 'TECH_LEAD',
    name: 'Tech Lead Agent',
    summary: 'Technical planning and investigation: the technical solution of each task and the split of large work into tasks.',
    description:
      'Senior technical lead and software architect for technical planning, architecture analysis, investigations, trade-off evaluations, impact assessment, and task decomposition before implementation. Aligns on critical technical decisions with the user and refines the board technically: the technical solution of each task (affected files, steps, tests, verification) and the split of large work into dependent tasks, answering with the ids it created or changed plus a summary. Delegate to it with the task or feature to refine, or with a project folder for an investigation.',
    buildSystemPrompt: () => TECH_LEAD_SYSTEM_PROMPT,
    delegation: { project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional', asksUser: true, refines: 'technical' },
    artifacts: TECH_LEAD_ARTIFACT_ACCESS,
    reentryNote: TECH_LEAD_REENTRY_NOTE,
  },
  {
    role: 'DEVELOPER',
    name: 'Developer Agent',
    summary: 'Implements one task end to end on a branch of its own: code, tests, commits, the push and the pull request.',
    description:
      'Senior software engineer that takes a task of the board from its specification to work ready for review, inside its project: implementation, refactoring, bug fixing and automated tests, run through the checks the project defines, committed on the branch of the task, pushed, and opened or updated as the pull request of that task, which it links on the task with its branch and implementation notes. It also runs the commands a project documents for itself, such as package.json scripts, Makefile targets, and setup or init scripts described in README or AGENTS.md, even when they install dependencies or clone sub-repositories. It works only in a project folder that already holds the repository, and only on the branch of its task: merging, rebasing onto or pushing to other branches, force pushes and cloning belong to the agent that administers repositories. It answers DONE when everything the task asks is committed, pushed and checked, or INCOMPLETE with what is missing. Delegate the same task to it again to fix review or test findings.',
    buildSystemPrompt: () => DEVELOPER_SYSTEM_PROMPT,
    delegation: {
      project: 'required',
      artifact: 'required',
      statusFlow: {
        from: ['ready', 'in_progress', 'changes_requested'],
        start: 'in_progress',
        verdicts: { DONE: 'in_review', INCOMPLETE: 'in_progress' },
      },
    },
    artifacts: DEVELOPER_ARTIFACT_ACCESS,
    reentryNote: DEVELOPER_REENTRY_NOTE,
  },
  {
    role: 'CODE_REVIEWER',
    name: 'Code Reviewer Agent',
    summary: 'Independent review of the work on a task, its pull request or its branch.',
    description:
      'Senior code reviewer for rigorous, unbiased review of the work on a task: its open pull request, or its branch reviewed locally when there is none. It judges the change against the task, the project conventions, security checklists, and functional correctness, and never runs the project or its tests: it reads the results of the pull request pipeline. It records its findings on the task, publishes them on the pull request when there is one, and answers with the verdict, APPROVED or CHANGES_REQUESTED. Its first review of a task starts without any memory of the implementation; a later review of the same task continues from its own earlier findings.',
    buildSystemPrompt: () => CODE_REVIEWER_SYSTEM_PROMPT,
    delegation: {
      project: 'required',
      readOnly: true,
      artifact: 'required',
      needsReviewableWork: true,
      statusFlow: {
        from: ['in_review'],
        verdicts: { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested' },
      },
    },
    artifacts: CODE_REVIEWER_ARTIFACT_ACCESS,
    reentryNote: CODE_REVIEWER_REENTRY_NOTE,
  },
  {
    role: 'QA',
    name: 'QA Agent',
    summary: 'Tests the work on a task in practice by running the application, after its review.',
    description:
      'Quality analyst that tests the work on a task in practice, after its review: it runs the application from the task\'s branch and exercises the acceptance criteria and test cases as a user or client would, with Playwright for web interfaces and HTTP APIs and mobile-mcp for mobile apps. It prepares its own test environment, so delegate that preparation to it as part of the test: it starts services and containers, runs migrations and seeds, changes local databases, environment variables, configuration and code to force a scenario, and rebuilds the app. It never commits or pushes any of it, and leaves the project as it found it. It records the test report on the task and answers with the verdict: PASSED, FAILED when the work must change, or BLOCKED when something outside the task kept it from testing, with what it needs. Delegate the same task to it again to test a fix or to go on once it is unblocked.',
    buildSystemPrompt: () => QA_SYSTEM_PROMPT,
    delegation: {
      project: 'required',
      artifact: 'required',
      needsReviewableWork: true,
      statusFlow: {
        from: ['approved', 'in_testing'],
        start: 'in_testing',
        verdicts: { PASSED: 'tested', FAILED: 'changes_requested', BLOCKED: 'in_testing' },
      },
    },
    artifacts: QA_ARTIFACT_ACCESS,
    reentryNote: QA_REENTRY_NOTE,
  },
  {
    role: 'IT_SUPPORT',
    name: 'IT Support Agent',
    summary: 'Sets up and fixes the machine the agents run on, only on the user\'s decision.',
    description:
      'IT support and system administration for the machine the agents run on, Windows, Linux or macOS: installing programs, SDKs and runtimes, operating system settings, environment variables, and fixing the environment, such as starting Docker or another service a project needs. It investigates the environment first, read-only, then asks the user to approve a plain-language plan and changes nothing before the approval. Never delegate to it on your own: suggest it to the user with a question and delegate only when the user agrees or asks for it explicitly. Delegate to it without a project folder for work on the machine, or with one for an environment problem of that project.',
    buildSystemPrompt: () => IT_SUPPORT_SYSTEM_PROMPT,
    delegation: { project: 'optional', sessionMode: 'overridable', asksUser: true, userInitiatedOnly: true },
    artifacts: IT_SUPPORT_ARTIFACT_ACCESS,
    reentryNote: IT_SUPPORT_REENTRY_NOTE,
  },
];
