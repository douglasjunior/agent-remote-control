import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';

import { buildCeoSystemPrompt, CEO_TURN_REMINDER } from './ceo.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


const developer: AgentDefinition = {
  role: 'DEVELOPER',
  name: 'Developer Agent',
  description: 'Writes code.',
  buildSystemPrompt: () => 'dev',
  delegation: { project: 'required', sessionMode: 'overridable' },
  turnReminder: 'dev reminder',
};

const CEO_SYSTEM_PROMPT = buildCeoSystemPrompt([developer]);

describe('ceo.prompt', () => {
  it('should require the final answer and its markers inside the final response block', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(CEO_SYSTEM_PROMPT).toContain('Markers go inside the final response block');
  });

  it('should define the CEO as the lead orchestrator of agent-remote-control', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('You are the CEO, the lead orchestrator of agent-remote-control.');
    expect(CEO_SYSTEM_PROMPT).toContain('DEVELOPER');
  });

  it('should define workspace architecture as a multi-project container', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Workspace Architecture & Context');
    expect(CEO_SYSTEM_PROMPT).toContain('multi-project container where each direct subfolder is an independent project or repository');
    expect(CEO_SYSTEM_PROMPT).toContain('agent-remote-control');
  });

  it('should instruct the CEO to discover active projects by listing its CWD', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('List your CWD to discover the active projects.');
  });

  it('should require everything an agent needs from the user and earlier agent results in the specification', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(
      'An agent only knows what you write, so the specification carries everything it needs from the conversation',
    );
    expect(CEO_SYSTEM_PROMPT).toContain('details from the user, such as a repository URL');
    expect(CEO_SYSTEM_PROMPT).toContain('verbatim, commands or verified facts from earlier agent results');
    expect(CEO_TURN_REMINDER).toContain('Carry commands and verified facts from agent results verbatim');
  });

  it('should prefer the project documented commands over manual reproduction of their steps', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(
      'ask for that command instead of a manual reproduction of its steps',
    );
    expect(CEO_TURN_REMINDER).toContain('prefer the project\'s documented commands over manual steps');
  });

  it('should answer questions about its own decisions without delegating unless it lacks the information', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(
      'When the user questions one of your decisions, explain your reasoning in the same turn; delegate only if the answer needs information you do not have yet.',
    );
    expect(CEO_TURN_REMINDER).toContain('answer it yourself unless you lack the information');
  });

  it('should stop delegating when the user tells it to stop', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('mean stop delegating and reply to the user\'s last question');
    expect(CEO_TURN_REMINDER).toContain('When told to stop, stop delegating.');
  });

  it('should direct the CEO to focus on actual workspace projects and suggest initialization if empty', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Anchor your answers about capabilities, current projects, or scope in the projects actually present.');
    expect(CEO_SYSTEM_PROMPT).toContain('propose adding a repository to it');
  });

  it('should enforce pure orchestration and prohibit direct technical execution', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Fundamental Role: Pure Orchestration');
    expect(CEO_SYSTEM_PROMPT).toContain('You NEVER execute technical work directly.');
    expect(CEO_SYSTEM_PROMPT).toContain('All hands-on technical work must be delegated to specialized agents from Your Team.');
    expect(CEO_SYSTEM_PROMPT).not.toContain('Only when no agent is capable of it do you handle the task yourself');
  });

  it('should define CEO_TURN_REMINDER with role reminder and delegation protocol', () => {
    expect(CEO_TURN_REMINDER).toContain('strictly an orchestrator, planner, and reviewer');
    expect(CEO_TURN_REMINDER).toContain('NEVER execute technical tasks');
    expect(CEO_TURN_REMINDER).toContain('[DELEGATE:ROLE:project-folder]');
    expect(CEO_TURN_REMINDER).toContain('[DELEGATE:ROLE:project-folder:new]');
    expect(CEO_TURN_REMINDER).toContain('top-level root directory of the project');
    expect(CEO_TURN_REMINDER).toContain('never nested paths or internal subfolders');
    expect(CEO_TURN_REMINDER).toContain('[DONE]');
  });

  it('should not include execution abilities', () => {
    expect(CEO_SYSTEM_PROMPT).not.toContain('Plan Mode & Codebase Inspection');
  });

  it('should describe the delegation marker protocol', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('[DELEGATE:ROLE:project-folder]');
    expect(CEO_SYSTEM_PROMPT).toContain('top-level root directory of the project');
    expect(CEO_SYSTEM_PROMPT).toContain('never nested paths or internal subfolders');
    expect(CEO_SYSTEM_PROMPT).toContain('[DONE]');
    expect(CEO_SYSTEM_PROMPT).toContain('[AGENT_RESULT:ROLE]');
  });

  it('should confine the CEO to its working directory and require risk confirmation outside', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Workspace Boundaries & Safety Rules');
    expect(CEO_SYSTEM_PROMPT).toContain('Stay inside the `workspaces` directory and its subfolders.');
    expect(CEO_SYSTEM_PROMPT).toContain('Operating outside `workspaces` (such as accessing parent directories, external paths, or host system files) is dangerous.');
    expect(CEO_SYSTEM_PROMPT).toContain('MUST alert the user about the risks and request explicit confirmation before taking action');
    expect(CEO_SYSTEM_PROMPT).not.toContain('currently running you');
  });

  it('should relay SSH public keys requested by agents verbatim to the user', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('relay the full key block verbatim');
  });

  it('should keep internal rules out of user-facing replies', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Communication Style');
    expect(CEO_SYSTEM_PROMPT).toContain('Follow them silently');
  });

  it('should list every team member with role, name, and description', () => {
    const reviewer: AgentDefinition = {
      role: 'REVIEWER',
      name: 'Reviewer Agent',
      description: 'Reviews code.',
      buildSystemPrompt: () => 'rev',
      delegation: { project: 'required' },
      defaultSessionMode: 'new',
      turnReminder: 'rev reminder',
    };

    const prompt = buildCeoSystemPrompt([developer, reviewer]);

    expect(prompt).toContain('- DEVELOPER (Developer Agent): Writes code.');
    expect(prompt).toContain('- REVIEWER (Reviewer Agent): Reviews code.');
  });

  it('should state the accepted marker shape of each team member', () => {
    const gitOps: AgentDefinition = {
      role: 'GIT_OPS',
      name: 'Git Ops Agent',
      description: 'Runs git.',
      buildSystemPrompt: () => 'git',
      delegation: { project: 'optional', sessionMode: 'overridable' },
      turnReminder: 'git reminder',
    };

    const prompt = buildCeoSystemPrompt([developer, gitOps]);

    expect(prompt).toContain(
      'Delegate as [DELEGATE:DEVELOPER:<project-folder>]. It runs in "resume" session mode unless you append :new or :resume.',
    );
    expect(prompt).toContain(
      'Delegate as [DELEGATE:GIT_OPS] or [DELEGATE:GIT_OPS:<project-folder>]. It runs in "resume" session mode unless you append :new or :resume.',
    );
  });

  it('should forbid a session mode for a team member whose mode is fixed', () => {
    const reviewer: AgentDefinition = {
      role: 'REVIEWER',
      name: 'Reviewer Agent',
      description: 'Reviews code.',
      buildSystemPrompt: () => 'rev',
      delegation: { project: 'required' },
      defaultSessionMode: 'new',
      turnReminder: 'rev reminder',
    };

    expect(buildCeoSystemPrompt([reviewer])).toContain(
      'Delegate as [DELEGATE:REVIEWER:<project-folder>]. It always runs in "new" session mode, so never append :new or :resume.',
    );
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });

  it('should instruct the CEO to delegate based on Your Team descriptions and sequence across phases without hardcoded roles in delegation section', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(
      'Delegate each technical task to the agent in Your Team whose description best fits it.',
    );
    expect(CEO_SYSTEM_PROMPT).toContain(
      'Sequence delegations logically across team members according to their described specializations when a request spans multiple phases (such as planning/investigation before execution, and review before completion).',
    );

    const delegationSection = CEO_SYSTEM_PROMPT.slice(
      CEO_SYSTEM_PROMPT.indexOf('2. Delegation:'),
      CEO_SYSTEM_PROMPT.indexOf('3. Review:'),
    );
    expect(delegationSection).not.toContain('TECH_LEAD');
    expect(delegationSection).not.toContain('DEVELOPER');
    expect(delegationSection).not.toContain('CODE_REVIEWER');
  });
});
