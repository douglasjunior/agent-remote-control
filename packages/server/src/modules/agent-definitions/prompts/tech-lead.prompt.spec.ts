import { describe, expect, it } from '@rstest/core';

import { TECH_LEAD_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';
import { buildTechLeadReentryNote, buildTechLeadSystemPrompt } from './tech-lead.prompt.js';
import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';


const TECH_LEAD_SYSTEM_PROMPT = buildTechLeadSystemPrompt('tags');
const TECH_LEAD_REENTRY_NOTE = buildTechLeadReentryNote('tags');

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

    it('should recommend with the technical trade-off and read facts instead of asking them', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('The rationale gives the technical trade-off behind your recommendation');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('accepting it is an informed decision in one click');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('What the code, the documentation or the board answers is a fact to read, never a question');
    });

    it('should follow a decision the project already made and cite where it is recorded', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('A decision the project already made is not asked again');
    });

    it('should interview in rounds over the frontier, starting with the decisions that constrain the most', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('### Interviewing');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Start with the decisions that constrain the most (architecture, data model, contracts between parts, new dependencies)');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Each round asks every decision whose prerequisites are settled, all at once');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('Stop asking only when no open decision is left');
    });

    it('should have the user confirm the summary of the decisions when it asked anything', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('When you asked anything, send one last short round before writing the board');
    });

    it('should explain how to ask the user', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    });
  });

  describe('the board', () => {
    it('should write the technical solution of each task with the files, steps, tests and verification commands', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('The `technical_solution` of each task holds the design');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('the exact files and modules to create, change or remove (with their git repository when the project holds several), the ordered steps, the automated tests to add, and the commands that verify the work');
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('the command that checks a single changed file (its tests and lint) while the work is in progress, and the commands that check each affected package (tests, linter, build) at the end');
    });

    it('should split large work into tasks ordered by dependencies, each fitting one review in one project', () => {
      expect(TECH_LEAD_SYSTEM_PROMPT).toContain('with `depends_on` giving the order; a task fits one review and works in one project');
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
    expect(TECH_LEAD_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(TECH_LEAD_ARTIFACT_ACCESS, 'tags'));
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

    it('should carry the frontier per round and the confirmed summary', () => {
      expect(TECH_LEAD_REENTRY_NOTE).toContain('each round asks the whole frontier');
      expect(TECH_LEAD_REENTRY_NOTE).toContain('When you asked anything, the user confirms the summary of the decisions in one last `<question>`');
    });
  });

  describe('on the tools interface', () => {
    const prompt = buildTechLeadSystemPrompt('tools');
    const note = buildTechLeadReentryNote('tools');

    it('should keep every passage that does not depend on the interface', () => {
      expect(prompt).toContain('### Decisions Belong to the User');
      expect(prompt).toContain('### Interviewing');
      expect(prompt).toContain('the command that checks a single changed file');
      expect(prompt).toContain('Set `technical_refinement="done"` on every artifact you refined.');
      expect(prompt).toContain(buildArtifactProtocolBrief(TECH_LEAD_ARTIFACT_ACCESS, 'tools'));
      expect(prompt).toContain(USER_QUESTIONS_BRIEF);
    });

    it('should use the id each creation returns and fix a refused call before the next one', () => {
      expect(prompt).toContain('A creation returns the new id, for the `parent` and `depends_on` of the next ones.');
      expect(prompt).toContain('A call the board refuses says why: fix the cause before the next call');
      expect(prompt).not.toContain('send one first and read its result');
      expect(prompt).not.toContain('<artifact_');
    });

    it('should keep the question rule in the re-entry note and name the tools', () => {
      expect(note).toContain('is a `<question>` to the user, with your recommendation first');
      expect(note).toContain('each round asks the whole frontier');
      expect(note).toContain('the tools of the `arc` MCP server');
    });
  });
});
