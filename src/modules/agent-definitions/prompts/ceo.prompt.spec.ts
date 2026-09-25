import { describe, expect, it } from 'vitest';
import { CEO_SYSTEM_PROMPT } from './ceo.prompt.js';

describe('ceo.prompt', () => {
  it('should define executive router role, triage, and delegation to developer', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('CEO and Executive Router Agent');
    expect(CEO_SYSTEM_PROMPT).toContain('Executive Triage & Scoping');
    expect(CEO_SYSTEM_PROMPT).toContain('DEVELOPER');
  });

  it('should integrate plan ability into CEO prompt', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Plan Mode & Codebase Inspection');
  });
});
