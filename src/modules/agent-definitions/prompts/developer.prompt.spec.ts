import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT } from './developer.prompt.js';


describe('developer.prompt', () => {
  it('should define senior software engineer role and target project adaptability', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Senior Software Engineer');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'Target Architecture & Project Conventions',
    );
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Testing Excellence');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'Verification & Project Tooling',
    );
  });

  it('should integrate plan and git abilities into developer prompt', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'Plan Mode & Codebase Inspection',
    );
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'Git Version Control & Commit Conventions',
    );
  });
});
