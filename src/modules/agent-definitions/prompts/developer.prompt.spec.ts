import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT } from './developer.prompt.js';


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
});
