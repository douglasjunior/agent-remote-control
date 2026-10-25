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

  it('should require the final answer and its markers inside the final response block', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(CEO_SYSTEM_PROMPT).toContain('end with the marker alone on the last line');
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
    expect(CEO_SYSTEM_PROMPT).toContain('Append `:new` when the work is a new task or subject for that agent');
  });

  it('should allow parallel delegations with one agent that modifies files per project', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('write several delegations in one response, each task specification right before its own marker');
    expect(CEO_SYSTEM_PROMPT).toContain('one `[AGENT_RESULT:ROLE:project-folder]` each');
    expect(CEO_SYSTEM_PROMPT).toContain('Only one agent that modifies files may work in a project folder at a time');
    expect(CEO_SYSTEM_PROMPT).toContain('redirects that agent instead of starting another one');
  });

  it('should grant access outside a project folder by resuming the agent with the exact path', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('anything outside the workspaces root needs the user\'s confirmation first');
    expect(CEO_SYSTEM_PROMPT).toContain('delegating again to the same agent with `:resume`, naming the exact path');
  });

  it('should describe how to finish, talk to the user, and send attachments', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('end with `[DONE]`');
    expect(CEO_SYSTEM_PROMPT).toContain('never mention markers');
    expect(CEO_SYSTEM_PROMPT).toContain('![description](file:///absolute/path.png)');
    expect(CEO_SYSTEM_PROMPT).toContain('[file-name](file:///absolute/path)');
  });

  it('should list each team member with its marker forms and session mode', () => {
    const prompt = buildCeoSystemPrompt([developer, reviewer]);

    expect(prompt).toContain(
      '- DEVELOPER (Developer Agent): [DELEGATE:DEVELOPER:<project-folder>]. Runs in "resume" session mode unless you append :new or :resume. Modifies files,',
    );
    expect(prompt).toContain(
      '- REVIEWER (Reviewer Agent): [DELEGATE:REVIEWER:<project-folder>]. Always runs in "new" session mode, so never append :new or :resume. Read-only,',
    );
    expect(prompt).not.toContain('Writes code.');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });
});
