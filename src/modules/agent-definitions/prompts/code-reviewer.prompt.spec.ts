import { describe, expect, it } from 'vitest';

import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  CODE_REVIEWER_TURN_REMINDER,
} from './code-reviewer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('code-reviewer.prompt', () => {
  it('should define code reviewer agent role and its core principles', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Code Reviewer Agent');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Grounded & Objective Review');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Project Context & Conventions First');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Security Lens');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Findings Structure');
  });

  it('should prohibit inventing problems and modifying code files', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Do NOT invent problems.');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('do NOT modify code files directly.');
  });

  it('should require the final answer inside the final response block', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should confine the code reviewer to its project folder', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('project folder assigned to you. Stay inside it');
  });

  it('should define CODE_REVIEWER_TURN_REMINDER with objective review, findings format, and final response instructions', () => {
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('independent, unbiased code reviewer');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('Never invent problems');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('<final_response>');
  });

  it('should instruct the agent to suggest publishing PR comments when reviewing a Pull Request with findings', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Pull Request (PR) Comment Publishing');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(
      'When reviewing a Pull Request (PR) and findings are identified',
    );
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(
      'suggest publishing the findings as comments on the pull request',
    );
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(
      'ask the user to reply indicating which specific findings',
    );
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(
      'When reviewing a Pull Request (PR) with identified findings, proactively suggest publishing them as PR comments',
    );
  });
});
