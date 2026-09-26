import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';

import { buildCeoSystemPrompt, CEO_TURN_REMINDER } from './ceo.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


const developer: AgentDefinition = {
  role: 'DEVELOPER',
  name: 'Developer Agent',
  description: 'Writes code.',
  buildSystemPrompt: () => 'dev',
};

const CEO_SYSTEM_PROMPT = buildCeoSystemPrompt([developer]);

describe('ceo.prompt', () => {
  it('should require the final answer and its markers inside the final response block', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(CEO_SYSTEM_PROMPT).toContain('Markers go inside the final response block');
  });

  it('should define the CEO as a leader of the agent team', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('You are the CEO.');
    expect(CEO_SYSTEM_PROMPT).toContain('DEVELOPER');
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
    expect(CEO_TURN_REMINDER).toContain('[DONE]');
  });

  it('should not include execution abilities', () => {
    expect(CEO_SYSTEM_PROMPT).not.toContain('Plan Mode & Codebase Inspection');
  });

  it('should describe the delegation marker protocol', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('[DELEGATE:ROLE:project-folder]');
    expect(CEO_SYSTEM_PROMPT).toContain('[DONE]');
    expect(CEO_SYSTEM_PROMPT).toContain('[AGENT_RESULT:ROLE]');
  });

  it('should confine the CEO to its working directory', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Workspace Boundaries');
    expect(CEO_SYSTEM_PROMPT).toContain('Stay inside it and its subfolders');
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
    };

    const prompt = buildCeoSystemPrompt([developer, reviewer]);

    expect(prompt).toContain('- DEVELOPER (Developer Agent): Writes code.\n- REVIEWER (Reviewer Agent): Reviews code.');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });
});
