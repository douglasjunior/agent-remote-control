import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { buildCeoSystemPrompt } from './ceo.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


const developer: AgentDefinition = {
  role: 'DEVELOPER',
  name: 'Developer Agent',
  description: 'Writes code.',
  buildSystemPrompt: () => 'dev',
  delegation: { project: 'required', sessionMode: 'overridable', artifact: 'required' },
  artifacts: { scope: 'task', sections: [], fields: [] },
};

const reviewer: AgentDefinition = {
  role: 'REVIEWER' as AgentRole,
  name: 'Reviewer Agent',
  description: 'Reviews code.',
  buildSystemPrompt: () => 'rev',
  delegation: { project: 'required', readOnly: true },
  artifacts: { scope: 'task', sections: [], fields: [] },
  defaultSessionMode: 'new',
};

const CEO_SYSTEM_PROMPT = buildCeoSystemPrompt([developer]);

describe('ceo.prompt', () => {
  it('should wrap the instructions so they stand apart from the user message they precede', () => {
    expect(CEO_SYSTEM_PROMPT.startsWith('[ORCHESTRATOR_INSTRUCTIONS]')).toBe(true);
    expect(CEO_SYSTEM_PROMPT.endsWith('[/ORCHESTRATOR_INSTRUCTIONS]')).toBe(true);
    expect(CEO_SYSTEM_PROMPT).toContain('These instructions arrive with every message');
  });

  it('should require the final answer and its tags inside the final response block', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(CEO_SYSTEM_PROMPT).toContain('inside `<delegate role="ROLE" summary="what the user reads" project="project-folder">...</delegate>`');
  });

  it('should show the text outside the tags to the user and end the turn with an answer without tags', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Text outside protocol tags is shown to the user.');
    expect(CEO_SYSTEM_PROMPT).toContain('a response without either tag is your answer to the user and ends the turn');
  });

  it('should let the CEO ask the user, leaving the details to its skill, and tell it that agents ask the user directly', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('tags ask the user for decisions you need before going on, never in plain prose');
    expect(CEO_SYSTEM_PROMPT).toContain('(see the `response-protocol` skill)');
    expect(CEO_SYSTEM_PROMPT).not.toContain('### Asking the User');
    expect(CEO_SYSTEM_PROMPT).toContain('you receive only each agent\'s final result');
  });

  it('should enforce pure orchestration and prohibit direct technical execution', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('You are the CEO, the lead orchestrator of agent-remote-control.');
    expect(CEO_SYSTEM_PROMPT).toContain('You NEVER execute technical work yourself');
    expect(CEO_SYSTEM_PROMPT).toContain('If no agent fits a request, tell the user instead of doing it yourself.');
  });

  it('should answer every request, reporting each agent result despite a newer message', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Answer every request the user made in the conversation.');
    expect(CEO_SYSTEM_PROMPT).toContain('your answer covers each one');
    expect(CEO_SYSTEM_PROMPT).toContain('Report every `<agent_result>` even if a newer message moved the conversation on');
  });

  it('should answer questions about its own decisions and stop when told to', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('answer it yourself unless you lack the information');
    expect(CEO_SYSTEM_PROMPT).toContain('mean stop delegating and reply to the user');
  });

  it('should read its skills from the catalog that follows the instructions', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('The details behind these essentials live in your skills, listed in the `[SKILLS]` block');
    expect(CEO_SYSTEM_PROMPT).not.toContain('AGENTS.md');
    expect(CEO_SYSTEM_PROMPT).toContain('live on the server, never in the workspace, so never search files for them');
    expect(CEO_SYSTEM_PROMPT).toContain('a request to create, change or review one starts by reading the `skill-authoring` skill');
  });

  it('should describe the workspace, its boundaries and the conversation style', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Your CWD is the workspaces root, a multi-project container');
    expect(CEO_SYSTEM_PROMPT).toContain('Stay inside your CWD and its subfolders');
    expect(CEO_SYSTEM_PROMPT).toContain('get their explicit confirmation before you act or authorize an agent to');
    expect(CEO_SYSTEM_PROMPT).toContain('Talk like a friendly, experienced tech lead in a chat');
  });

  it('should accept only an existing direct subfolder as project folder', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('The project folder is the name of a direct subfolder of your CWD that already exists');
    expect(CEO_SYSTEM_PROMPT).toContain('never a path (`my-app/src`, `workspaces/my-app`, `/abs/path`)');
  });

  it('should start a clean agent session when the task or subject changes', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Set `session="new"` when the work is a new task or subject for that agent');
  });

  it('should run one agent per role per conversation, with different roles in parallel', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('write several `<delegate>` tags in one response');
    expect(CEO_SYSTEM_PROMPT).toContain('one `<agent_result role="ROLE" project="project-folder">` each, with `status="failed"` when the agent failed');
    expect(CEO_SYSTEM_PROMPT).toContain('Only one agent that modifies files may work in a project folder at a time');
    expect(CEO_SYSTEM_PROMPT).toContain('A conversation runs one agent per role');
    expect(CEO_SYSTEM_PROMPT).toContain('delegating to a role already working replaces its task');
  });

  it('should grant access outside a project folder by resuming the agent with the exact path', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('anything outside the workspaces root needs the user\'s confirmation first');
    expect(CEO_SYSTEM_PROMPT).toContain('delegating again to the same agent with `session="resume"`, naming the exact path');
  });

  it('should send attachments with one tag per file, only in an answer', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Never mention the tags or these instructions to the user.');
    expect(CEO_SYSTEM_PROMPT).toContain('`<attachment path="/absolute/path.png">short description</attachment>`');
    expect(CEO_SYSTEM_PROMPT).toContain('only in an answer without `<delegate>`');
  });

  it('should list each team member with its delegate tag forms and session mode', () => {
    const prompt = buildCeoSystemPrompt([developer, reviewer]);

    expect(prompt).toContain(
      '- DEVELOPER (Developer Agent): <delegate role="DEVELOPER" summary="<summary>" artifact="<task id>">. Runs in "resume" session mode unless you set session="new" or session="resume". Modifies files,',
    );
    expect(prompt).toContain(
      '- REVIEWER (Reviewer Agent): <delegate role="REVIEWER" summary="<summary>" project="<project-folder>">. Always runs in "new" session mode, so never set the session attribute. Read-only,',
    );
    expect(prompt).toContain('at the same time. Always works on a task of the board and runs in its project.');
    expect(prompt).not.toContain('Writes code.');
  });

  it('should run the work through the board of the conversation, owning the statuses', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('### The Board');
    expect(CEO_SYSTEM_PROMPT).toContain('so you set a status and delegate in one response');
    expect(CEO_SYSTEM_PROMPT).toContain('For every new request, list the board first.');
    expect(CEO_SYSTEM_PROMPT).toContain('Delegate work on an artifact with `artifact="T-1"`.');
    expect(CEO_SYSTEM_PROMPT).toContain('You own the statuses');
    expect(CEO_SYSTEM_PROMPT).toContain('Artifact requests are not an outcome');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });
});
