import { describe, expect, it } from 'vitest';

import {
  CODE_REVIEWER_SYSTEM_PROMPT,
  CODE_REVIEWER_TURN_REMINDER,
} from './code-reviewer.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('code-reviewer.prompt', () => {
  it('should define code reviewer agent role and its core principles', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Code Reviewer Agent');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Grounded & Objective Review');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Project Context & Conventions First');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Security Lens');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Findings Structure');
  });

  it('should prohibit inventing problems, modifying production code files, or creating commits', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Do NOT invent problems.');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(
      'do NOT modify production code files directly or create commits in the repository.',
    );
  });

  it('should authorize MCP tools and CLI commands to inspect and publish PR comments within repository boundaries', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(
      'authorized and expected to use MCP tools and CLI commands to inspect the repository and to publish review comments on PRs/MRs when requested.',
    );
  });

  it('should require the final answer inside the final response block', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should confine the code reviewer to its CWD in the prompt and in every turn', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
  });

  it('should define CODE_REVIEWER_TURN_REMINDER with objective review, findings format, PR publishing, and final response instructions', () => {
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('independent, unbiased code reviewer');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('Never invent problems');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('<final_response>');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(
      'When reviewing a Pull Request (PR) with identified findings, proactively suggest publishing them as PR comments',
    );
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(
      'strict tool hierarchy (MCP -> Official CLI -> No Fallback)',
    );
  });

  it('should instruct multi-provider PR comment publishing with strict tool hierarchy and anchoring rules', () => {
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

    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Multi-Provider Detection: Inspect `git remote -v`');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('GitHub, GitLab, Azure DevOps, or Bitbucket');

    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Strict Tool Hierarchy (MCP -> Official CLI -> No Fallback)');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('MCP (Model Context Protocol): Primary choice.');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Official CLI: Secondary choice.');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('No Fallback: If neither MCP tools nor an official CLI are available');

    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Inline on Diff: Point findings with a valid file and line in the diff must be anchored to the exact line of the new version');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('side: RIGHT');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('General Discussion: Use general PR/MR discussion thread comments only for global');
  });

  it('should leave the questions to the user out of the review, which only reports findings', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).not.toContain(USER_QUESTIONS_INSTRUCTIONS);
    expect(CODE_REVIEWER_TURN_REMINDER).not.toContain(USER_QUESTIONS_REMINDER);
  });
});
