import { describe, expect, it } from '@rstest/core';

import { TECH_LEAD_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';
import { TECH_LEAD_REENTRY_NOTE, TECH_LEAD_SYSTEM_PROMPT } from './tech-lead.prompt.js';
import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';


describe('tech-lead.prompt', () => {
  it('should define the tech lead as the agent that plans before implementation and writes the plan on the board', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('You are the Tech Lead Agent');
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('write the plan on the team\'s board');
  });

  it('should write for a developer with no memory of this session', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain('A developer with no memory of this session implements each task from the task alone');
  });

  describe('planning', () => {
    it('should read the artifact, its business sections and pending decisions, then the code', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('a feature with `tree="true"` to see all its tasks');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('its `pending_decisions`');
    });

    it('should change no project file and run only commands that inspect', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('You change no project file and run only commands that inspect');
    });
  });

  describe('decisions', () => {
    it('should ask the user each design decision with the trade-offs and the recommendation first', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('are decisions for the user');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('before writing the solution: one option per viable approach, the one you recommend first, and the trade-offs in the rationale');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('When the documentation, the code and the request disagree, ask which one holds.');
    });

    it('should follow a decision the project already made and cite where it is recorded', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('A decision the project already made is not asked again');
    });

    it('should explain how to ask the user', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    });
  });

  describe('the board', () => {
    it('should write the technical solution of each task with the files, steps, tests and verification commands', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('The `technical_solution` of each task holds the design');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('the exact files and modules to create, change or remove, the ordered steps, the automated tests to add, and the commands that verify the work');
    });

    it('should split large work into tasks ordered by dependencies, each fitting one pull request', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('with `depends_on` giving the order; a task fits one pull request');
    });

    it('should set the technical refinement to done and keep what still holds when refining', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Set `technical_refinement="done"` on every artifact you refined');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('keep what still holds so earlier references stay valid');
    });

    it('should send one request of a batch first and read its result', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Before a batch of creations or updates, send one first and read its result');
    });

    it('should answer with the ids and what the caller must decide, without repeating the content', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Your final answer gives the ids you created or changed');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('It does not repeat their content.');
    });
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(TECH_LEAD_ARTIFACT_ACCESS));
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the tech lead back to its role guide', () => {
      expect(TECH_LEAD_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(TECH_LEAD_REENTRY_NOTE).toContain('a session you started as the Tech Lead Agent');
      expect(TECH_LEAD_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the no-change rule and the question rule', () => {
      expect(TECH_LEAD_REENTRY_NOTE).toContain('change no project file');
      expect(TECH_LEAD_REENTRY_NOTE).toContain('is a `<question>` to the user, with your recommendation first');
    });
  });
});
