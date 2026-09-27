import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';

import { buildCeoSystemPrompt, CEO_TURN_REMINDER } from './ceo.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


const developer: AgentDefinition = {
  role: 'DEVELOPER',
  name: 'Developer Agent',
  description: 'Writes code.',
  buildSystemPrompt: () => 'dev',
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
    expect(CEO_SYSTEM_PROMPT).toContain('multi-project container where each direct subfolder represents an independent project or repository');
    expect(CEO_SYSTEM_PROMPT).toContain('agent-remote-control');
  });

  it('should instruct the CEO to discover active projects using workspace-manifest.json and CWD inspection', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('workspace-manifest.json');
    expect(CEO_SYSTEM_PROMPT).toContain('metadata (name, Git URL, path, and default branch)');
    expect(CEO_SYSTEM_PROMPT).toContain('Inspect your CWD (by reading `workspace-manifest.json` or listing directories)');
  });

  it('should direct the CEO to focus on actual workspace projects and suggest initialization if empty', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('anchor your responses in the actual projects available in the workspace');
    expect(CEO_SYSTEM_PROMPT).toContain('propose cloning or initializing a new repository via the DEVELOPER');
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
    expect(CEO_SYSTEM_PROMPT).toContain('Stay inside it and its subfolders');
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
      turnReminder: 'rev reminder',
    };

    const prompt = buildCeoSystemPrompt([developer, reviewer]);

    expect(prompt).toContain('- DEVELOPER (Developer Agent): Writes code.\n- REVIEWER (Reviewer Agent): Reviews code.');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(buildCeoSystemPrompt([])).toContain('No agents are available for delegation.');
  });
});
