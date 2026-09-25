import { describe, expect, it } from 'vitest';

import { DEVELOPER_SYSTEM_PROMPT } from './developer.prompt.js';


describe('developer.prompt', () => {
  it('should define senior software engineer role and clean architecture principles', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Senior Software Engineer');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Clean Architecture');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('100% executable line coverage');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(
      'Mandatory Lint & Test Verification',
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
