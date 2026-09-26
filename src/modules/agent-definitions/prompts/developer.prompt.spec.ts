import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT } from './developer.prompt.js';
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
});
