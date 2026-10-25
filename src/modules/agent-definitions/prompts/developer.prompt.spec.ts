import { describe, expect, it } from 'vitest';

import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from './developer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('developer.prompt', () => {
  it('should define developer agent role and its capabilities', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Developer Agent');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Technical Execution');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Execute approved technical plans and specifications faithfully');
  });

  it('should embed commit conventions directly in Developer prompt', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Conventional Commits format in Portuguese (pt-BR)');
  });

  it('should keep the developer on the local side of Git', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'You own the local side of Git: inspecting the working tree, creating and switching local branches, staging, and committing your own work.',
    );
  });

  it('should put ad-hoc Git operations against a remote outside its scope without naming another agent', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Ad-hoc Git operations against a remote are outside your scope');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('state that in your final response and stop there');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('GIT_OPS');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('ssh-keygen');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('git clone');
  });

  it('should run the project documented commands even when they reach the network', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'The project\'s own commands are within your scope even when they reach the network',
    );
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('run it instead of reproducing its steps manually');
    expect(DEVELOPER_TURN_REMINDER).toContain('Prefer the commands the project documents');
  });

  it('should not contain plan ability since planning belongs to Tech Lead', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('Plan Mode & Codebase Inspection');
  });

  it('should require the final answer inside the final response block', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should confine the developer to its CWD in the prompt and in every turn', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(DEVELOPER_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('currently running you');
  });

  it('should define DEVELOPER_TURN_REMINDER with code quality, tests, and final response instructions', () => {
    expect(DEVELOPER_TURN_REMINDER).toContain('conventions, architecture, linters, and documentation');
    expect(DEVELOPER_TURN_REMINDER).toContain('automated tests');
    expect(DEVELOPER_TURN_REMINDER).toContain('<final_response>');
  });

  it('should explain to the developer how to ask the user, in the prompt and in every turn', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(USER_QUESTIONS_INSTRUCTIONS);
    expect(DEVELOPER_TURN_REMINDER).toContain(USER_QUESTIONS_REMINDER);
  });
});
