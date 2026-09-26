import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT, DEVELOPER_TURN_REMINDER } from './developer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('developer.prompt', () => {
  it('should define developer agent role and its capabilities', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Developer Agent');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Repository Boundaries');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Technical Execution');
  });

  it('should integrate abilities into Developer prompt', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Plan Mode & Codebase Inspection');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Git Version Control & Commit Conventions');
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
