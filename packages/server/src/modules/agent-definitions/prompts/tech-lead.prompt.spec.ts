import { describe, expect, it } from 'vitest';

import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { buildPlanDocumentInstructions, buildPlanDocumentReminder } from './plan-documents.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS, PROJECT_ORIENTATION_REMINDER } from './project-orientation.prompt.js';
import {
  TECH_LEAD_SYSTEM_PROMPT,
  TECH_LEAD_TURN_REMINDER,
} from './tech-lead.prompt.js';
import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('tech-lead.prompt', () => {
  it('should define tech lead agent role and its core principles', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Tech Lead Agent');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('general-purpose analytical agent');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Technical Planning & Architecture');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Read-Only Exploration & Non-Execution');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Decision Discipline');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Actionable Specification & Plan Structure');
  });

  it('should write the plan to plan.md and return its path instead of the plan', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Write the plan to `plan.md`');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(buildPlanDocumentInstructions('plan.md'));
    expect(TECH_LEAD_TURN_REMINDER).toContain(buildPlanDocumentReminder('plan.md'));
  });

  it('should prohibit modifying code files and enforce read-only exploration', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('strictly planning, specification, investigation, and architecture');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('do NOT modify code files, apply patches, create git commits, or implement production changes. The plan document is the only file you write');
  });

  it('should ask the user each design decision with the trade-offs and a recommendation', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Do NOT make silent assumptions or arbitrarily elect a solution');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Ask each decision as a question to the user (see Asking the User) before cementing the plan');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('your justified recommendation as the first option, and the trade-offs, pros, and cons in the rationale');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('ask which one holds instead of silently picking a side');
  });

  it('should explain how to ask the user in the prompt and in every turn', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(USER_QUESTIONS_INSTRUCTIONS);
    expect(TECH_LEAD_TURN_REMINDER).toContain(USER_QUESTIONS_REMINDER);
  });

  it('should specify plan structure with affected files, developer tasks with dependencies, and verification criteria', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Overview & Objectives');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Architecture & Technical Decisions');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Impact Analysis & Affected Areas');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('One `### Step N: <name>` heading per step, numbered from 1');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Verification & Acceptance Criteria');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Depends on: Step 1');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('keep the step numbers of the steps that remain valid');
  });

  it('should require the final answer inside the final response block', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should confine the tech lead to its CWD in the prompt and in every turn', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(TECH_LEAD_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
  });

  it('should orient the tech lead in the project documentation in the prompt and in every turn', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(TECH_LEAD_TURN_REMINDER).toContain(PROJECT_ORIENTATION_REMINDER);
  });

  it('should define TECH_LEAD_TURN_REMINDER with planning role, read-only restriction, decision discipline, and final response instructions', () => {
    expect(TECH_LEAD_TURN_REMINDER).toContain('Tech Lead and software architect');
    expect(TECH_LEAD_TURN_REMINDER).toContain('Do NOT implement production code or modify project files');
    expect(TECH_LEAD_TURN_REMINDER).toContain('Decide nothing silently');
    expect(TECH_LEAD_TURN_REMINDER).toContain('the pros and cons of each option and your recommendation');
    expect(TECH_LEAD_TURN_REMINDER).toContain('affected files, numbered steps for the Developer, and concrete verification criteria');
    expect(TECH_LEAD_TURN_REMINDER).toContain('<final_response>');
  });
});
