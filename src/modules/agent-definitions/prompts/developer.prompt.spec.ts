import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from './developer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('developer.prompt', () => {
  it('should define developer agent role and its capabilities', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Developer Agent');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Repository Boundaries');
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

  it('should put operations that reach a remote outside its scope without naming another agent', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Operations that reach a remote are outside your scope');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('state that in your final response and stop there');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('GIT_OPS');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('ssh-keygen');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('git clone');
  });

  it('should not contain plan ability since planning belongs to Tech Lead', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('Plan Mode & Codebase Inspection');
  });

  it('should require the final answer inside the final response block', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should confine the developer to its project folder', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('project folder assigned to you. Stay inside it');
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('currently running you');
  });

  it('should define DEVELOPER_TURN_REMINDER with code quality, tests, and final response instructions', () => {
    expect(DEVELOPER_TURN_REMINDER).toContain('conventions, architecture, linters, and documentation');
    expect(DEVELOPER_TURN_REMINDER).toContain('automated tests');
    expect(DEVELOPER_TURN_REMINDER).toContain('<final_response>');
  });
});
