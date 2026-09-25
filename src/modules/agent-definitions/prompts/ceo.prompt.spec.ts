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

  it('should describe the delegation marker protocol', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('[DELEGATE:ROLE:project-folder]');
    expect(CEO_SYSTEM_PROMPT).toContain('[DONE]');
    expect(CEO_SYSTEM_PROMPT).toContain('[AGENT_RESULT:ROLE]');
  });

  it('should confine the CEO to the workspaces directory', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('Workspace Boundaries');
    expect(CEO_SYSTEM_PROMPT).toContain('./workspaces/');
  });

  it('should relay SSH public keys requested by agents verbatim to the user', () => {
    expect(CEO_SYSTEM_PROMPT).toContain('relay the full key block verbatim');
  });
});
