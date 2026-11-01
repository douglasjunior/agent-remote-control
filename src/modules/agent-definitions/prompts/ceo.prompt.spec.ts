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
  delegation: { project: 'required', sessionMode: 'overridable' },
};

const reviewer: AgentDefinition = {
  role: 'REVIEWER' as AgentRole,
  name: 'Reviewer Agent',
  description: 'Reviews code.',
  buildSystemPrompt: () => 'rev',
  delegation: { project: 'required', readOnly: true },
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
    expect(CEO_SYSTEM_PROMPT).toContain('inside `<delegate role="ROLE" project="project-folder">...</delegate>`');
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

  it('should answer questions about its own decisions and stop when told to', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('answer it yourself unless you lack the information');
    expect(CEO_SYSTEM_PROMPT).toContain('mean stop delegating and reply to the user');
  });

  it('should point to the AGENTS.md and skills of its CWD without indexing the skills', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Follow its `AGENTS.md` and use the skills available there');
    expect(CEO_SYSTEM_PROMPT).not.toContain('SKILL.md');
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
      '- DEVELOPER (Developer Agent): <delegate role="DEVELOPER" project="<project-folder>">. Runs in "resume" session mode unless you set session="new" or session="resume". Modifies files,',
    );
    expect(prompt).toContain(
      '- REVIEWER (Reviewer Agent): <delegate role="REVIEWER" project="<project-folder>">. Always runs in "new" session mode, so never set the session attribute. Read-only,',
    );
    expect(prompt).not.toContain('Writes code.');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });
});
