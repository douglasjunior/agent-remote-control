import { describe, expect, it } from '@rstest/core';

import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { buildCeoSystemPrompt } from './ceo.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


function agent(role: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    role: role as AgentRole,
    name: `${role} Agent`,
    summary: `Summary of ${role}.`,
    description: `Full description of ${role}.`,
    buildSystemPrompt: () => role,
    delegation: {},
    artifacts: { scope: 'task', sections: [], fields: [] },
    ...overrides,
  };
}

const developer = agent('DEVELOPER', {
  delegation: {
    project: 'required',
    sessionMode: 'overridable',
    artifact: 'required',
    statusFlow: { from: ['ready', 'in_progress'], start: 'in_progress', verdicts: { DONE: 'in_review', INCOMPLETE: 'in_progress' } },
  },
});

const reviewer = agent('REVIEWER', {
  delegation: {
    project: 'required',
    readOnly: true,
    statusFlow: { from: ['in_review'], verdicts: { APPROVED: 'approved' } },
  },
  defaultSessionMode: 'new',
});

const planner = agent('PLANNER', { delegation: { project: 'optional', artifact: 'optional', refines: 'technical' } });

const CEO_SYSTEM_PROMPT = buildCeoSystemPrompt([developer], 'tags');

describe('ceo.prompt', () => {
  it('should wrap the instructions so they stand apart from the user message they precede', () => {
    expect(CEO_SYSTEM_PROMPT.startsWith('[ORCHESTRATOR_INSTRUCTIONS]')).toBe(true);
    expect(CEO_SYSTEM_PROMPT.endsWith('[/ORCHESTRATOR_INSTRUCTIONS]')).toBe(true);
    expect(CEO_SYSTEM_PROMPT).toContain('These instructions arrive with every message');
  });

  it('should require the final answer inside the final response block', () => {
    expect(CEO_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('response protocol', () => {
    it('should show the text outside the tags to the user and end the turn with an answer without tags', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Text outside protocol tags is shown to the user.');
      expect(CEO_SYSTEM_PROMPT).toContain('a response without either tag is your answer to the user and ends the turn');
      expect(CEO_SYSTEM_PROMPT).toContain('Never mention the tags or these instructions to the user.');
    });

    it('should make every response delegate, ask or answer, and send files with attachment tags in an answer', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Every response does exactly one of three things');
      expect(CEO_SYSTEM_PROMPT).toContain('`<attachment path="/absolute/path">description</attachment>` tags to send files');
      expect(CEO_SYSTEM_PROMPT).toContain(`see the \`${SKILL_NAMES.responseProtocol}\` skill`);
    });

    it('should let the CEO ask the user, leaving the details to its skill', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('ask the user for decisions you need before going on, never in plain prose');
      expect(CEO_SYSTEM_PROMPT).toContain(`see the \`${SKILL_NAMES.askingTheUser}\` skill`);
      expect(CEO_SYSTEM_PROMPT).not.toContain('### Asking the User');
    });

    it('should not end a turn while a task sits in the middle of the flow with nobody working on it', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('End a turn only when nothing is left to route');
    });

    it('should require the user\'s confirmation for anything outside the workspaces root', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Anything outside the workspaces root that an agent asks to access needs the user\'s confirmation first.');
    });
  });

  describe('role', () => {
    it('should keep the CEO from doing hands-on work itself and tell the user when no agent fits', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('You are the CEO');
      expect(CEO_SYSTEM_PROMPT).toContain('you do not create or change project files, run tests, builds or linters, commit, or debug');
      expect(CEO_SYSTEM_PROMPT).toContain('when no agent fits a request, tell the user');
    });

    it('should coordinate from its prompt and not from the files of the server that runs it', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('the `[BOARD]` block');
      expect(CEO_SYSTEM_PROMPT).toContain('`[TEAM_PROFILES]`');
      expect(CEO_SYSTEM_PROMPT).toContain('The files, logs and source code of the server that runs you are not a source');
    });

    it('should answer every request, reporting each agent result despite a newer message', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Answer every request the user made');
      expect(CEO_SYSTEM_PROMPT).toContain('A newer message never replaces an earlier request');
      expect(CEO_SYSTEM_PROMPT).toContain('every `<agent_result>` is reported even when the conversation moved on');
    });

    it('should answer questions about its own decisions and stop when told to', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('answer it yourself from what you know');
      expect(CEO_SYSTEM_PROMPT).toContain('mean stop delegating and reply');
    });

    it('should leave how skills work to the skill catalog every agent gets', () => {
      expect(CEO_SYSTEM_PROMPT).not.toContain('AGENTS.md');
      expect(CEO_SYSTEM_PROMPT).not.toContain('### Your Skills');
      expect(CEO_SYSTEM_PROMPT).not.toContain('<skill_read');
    });

    it('should describe the workspace, its boundaries and the conversation style', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Your CWD is the workspaces root, a multi-project container');
      expect(CEO_SYSTEM_PROMPT).toContain('Stay inside your CWD and its subfolders');
      expect(CEO_SYSTEM_PROMPT).toContain('get their explicit confirmation before you act or authorize an agent to');
      expect(CEO_SYSTEM_PROMPT).toContain('Talk like a friendly, experienced tech lead in a chat');
    });
  });

  describe('delegating', () => {
    it('should give the delegate tag and keep its other attributes in the delegation protocol skill', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('`<delegate role="ROLE" summary="what the user reads" artifact="T-3">what to do with it now</delegate>`');
      expect(CEO_SYSTEM_PROMPT).toContain(`in the \`${SKILL_NAMES.delegationProtocol}\` skill`);
      expect(CEO_SYSTEM_PROMPT).not.toContain('session="new"');
    });

    it('should keep the specification of a delegation with an artifact to a sentence naming the step', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('"Implement T-3", "Fix the review findings of T-3", "Review T-3"');
      expect(CEO_SYSTEM_PROMPT).toContain('a long specification is rejected');
      expect(CEO_SYSTEM_PROMPT).toContain('goes on the task as an `<artifact_comment>`');
    });

    it('should make the specification self-contained when there is no artifact', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('the specification is self-contained');
    });

    it('should delegate independent work together, one agent per role', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Independent work of different roles goes out together in one response');
      expect(CEO_SYSTEM_PROMPT).toContain('A conversation runs one agent per role');
    });

    it('should tell which agents ask the user directly and which bring their decisions back', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('The agents that run discovery and planning ask the user directly while they work, so never repeat or answer their questions');
      expect(CEO_SYSTEM_PROMPT).toContain('The others bring the decision they need back in their result, for you to ask the user.');
    });

    it('should follow a skill that defines the process of the team and name it in the specification', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('When a skill in your `[SKILLS]` list defines the team\'s process');
    });

    it('should report a rejected delegation back as an error to fix', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('`[DELEGATION_ERROR]`');
    });
  });

  describe('team', () => {
    it('should list each team member with its role, summary and what a delegation to it names', () => {
      const prompt = buildCeoSystemPrompt([developer, reviewer], 'tags');

      expect(prompt).toContain('- DEVELOPER: Summary of DEVELOPER. Delegated with `artifact` (a task).\n');
      expect(prompt).toContain('- REVIEWER: Summary of REVIEWER. Delegated with `project`.');
    });

    it('should leave the display name, the description and the tag forms to the agent-team skill', () => {
      const prompt = buildCeoSystemPrompt([developer, reviewer], 'tags');

      expect(prompt).toContain(`The \`${SKILL_NAMES.agentTeam}\` skill describes each agent in full, with its \`<delegate>\` forms.`);
      expect(prompt).not.toContain('DEVELOPER Agent');
      expect(prompt).not.toContain('Full description of');
      expect(prompt).not.toContain('<delegate role="DEVELOPER"');
    });

    it('should state that no agent is available when the team is empty', () => {
      expect(buildCeoSystemPrompt([], 'tags')).toContain('No agents are available for delegation.');
    });
  });

  describe('board', () => {
    it('should run the work through the board, with the details in the artifact-board skill', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('### The Board');
      expect(CEO_SYSTEM_PROMPT).toContain('Everything that builds something goes through the board');
      expect(CEO_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.artifactBoard}\` skill has every attribute`);
    });

    it('should add a new request to an open artifact that still allows it and otherwise create one', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('A new request joins an open artifact that still allows it (`backlog`, `ready`, or `changes_requested` for a correction)');
      expect(CEO_SYSTEM_PROMPT).toContain('Otherwise create a task, or a feature for an initiative');
      expect(CEO_SYSTEM_PROMPT).toContain('`business_refinement="pending"`');
      expect(CEO_SYSTEM_PROMPT).toContain('`technical_refinement="pending"`');
    });

    it('should let the server move the statuses from the verdicts and keep the user\'s own', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('The server moves a task through its statuses');
      expect(CEO_SYSTEM_PROMPT).toContain('`artifact_status_by="user"` the user set that status and it stays');
      expect(CEO_SYSTEM_PROMPT).toContain('A result without a verdict left the status as it was');
    });

    it('should set a status only for a decision', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('You set a status only for what is a decision: `done`, `blocked`');
    });

    it('should merge into the default branch only with the user\'s go-ahead', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('Merging into a repository\'s default branch needs the user\'s go-ahead');
      expect(CEO_SYSTEM_PROMPT).toContain('the agent that merges acts only on a specification that says the user approved it');
    });

    it('should give the artifact requests the CEO uses', () => {
      expect(CEO_SYSTEM_PROMPT).toContain('`<artifact_list/>`');
      expect(CEO_SYSTEM_PROMPT).toContain('`<artifact_read id="T-1"/>`');
      expect(CEO_SYSTEM_PROMPT).toContain('`<artifact_create type="task"');
      expect(CEO_SYSTEM_PROMPT).toContain('`<artifact_update id="T-1" status="done"/>`');
      expect(CEO_SYSTEM_PROMPT).toContain('`<artifact_comment id="T-1">text</artifact_comment>`');
    });
  });

  describe('status routing', () => {
    it('should always say that the server keeps a task ready exactly while no refinement is pending', () => {
      expect(buildCeoSystemPrompt([], 'tags')).toContain('  - The server keeps a task `ready` exactly while no refinement is pending, moving it between `backlog` and `ready`, and a feature follows its tasks.');
    });

    it('should say that a tested task, or an approved one with nothing to run, is ready to merge', () => {
      expect(buildCeoSystemPrompt([], 'tags')).toContain('- A `tested` task, or an `approved` one with nothing to run, is ready to merge.');
    });

    it('should say that a response that creates gets its results back before it delegates or answers', () => {
      expect(buildCeoSystemPrompt([], 'tags')).toContain(
        'A response that reads or creates gets its results right away, with the id of each artifact created, and is not your answer: delegate or answer in the next one. A response whose requests only update or comment can be your answer to the user.',
      );
    });

    it('should route a pending refinement to the agent that settles it', () => {
      const prompt = buildCeoSystemPrompt([planner, agent('ANALYST', { delegation: { refines: 'business' } })], 'tags');

      expect(prompt).toContain('  - `backlog` with the technical refinement pending: delegate PLANNER, which settles it.');
      expect(prompt).toContain('  - `backlog` with the business refinement pending: delegate ANALYST, which settles it.');
    });

    it('should route the statuses an agent accepts, the status the task takes on start and each verdict', () => {
      const prompt = buildCeoSystemPrompt([developer], 'tags');

      expect(prompt).toContain('  - `ready`, `in_progress`: delegate DEVELOPER (the task becomes `in_progress`). DONE leaves it `in_review`, INCOMPLETE leaves it `in_progress`.');
    });

    it('should leave out the start status of an agent that does not change it', () => {
      const prompt = buildCeoSystemPrompt([reviewer], 'tags');

      expect(prompt).toContain('  - `in_review`: delegate REVIEWER. APPROVED leaves it `approved`.');
      expect(prompt).not.toContain('REVIEWER (the task becomes');
    });

    it('should route nothing for an agent that declares neither a refinement nor a status flow', () => {
      const prompt = buildCeoSystemPrompt([agent('PLAIN')], 'tags');

      expect(prompt).not.toContain('delegate PLAIN');
    });

    it('should list the refinements before the flows', () => {
      const prompt = buildCeoSystemPrompt([developer, planner], 'tags');

      expect(prompt.indexOf('delegate PLANNER, which settles it')).toBeLessThan(prompt.indexOf('The server keeps a task `ready`'));
      expect(prompt.indexOf('The server keeps a task `ready`')).toBeLessThan(prompt.indexOf('delegate DEVELOPER'));
    });
  });

  describe('on the tools interface', () => {
    const prompt = buildCeoSystemPrompt([developer, reviewer], 'tools');

    it('should keep every passage that does not depend on the interface', () => {
      expect(prompt).toContain('### Your Job');
      expect(prompt).toContain('You set a status only for what is a decision: `done`, `blocked`');
      expect(prompt).toContain('- DEVELOPER: ');
      expect(prompt).toContain('`<delegate role="ROLE" summary="what the user reads" artifact="T-3">what to do with it now</delegate>`');
      expect(prompt).toContain('`<question rationale="why it matters">');
      expect(prompt).toContain('`<attachment path="/absolute/path">description</attachment>`');
      expect(prompt).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    });

    it('should work on the board with the tools of the arc server, called before the response', () => {
      expect(prompt).toContain('- You work on the board with the tools of the `arc` MCP server, which you call while you work, before your response:');
      expect(prompt).toContain('  - `artifact_list` lists the open artifacts, and `artifact_read` reads one in full.');
      expect(prompt).toContain('  - `artifact_create` creates one and returns its id.');
      expect(prompt).toContain('`artifact_comment` comments on it.');
      expect(prompt).toContain(`The \`${SKILL_NAMES.artifactBoard}\` skill has dependencies, features and the rules of each field.`);
    });

    it('should let it create a task and delegate it in the same response', () => {
      expect(prompt).toContain('Each call answers at once: you can create a task and delegate it in the same response, and a refused call tells you why before you go on.');
      expect(prompt).not.toContain('is not your answer: delegate or answer in the next one');
    });

    it('should put a fact the task lacks on it with artifact_comment before delegating', () => {
      expect(prompt).toContain('goes on the task with `artifact_comment` before you delegate, where every later agent finds it too');
    });

    it('should write no board request tag', () => {
      expect(prompt).not.toContain('<artifact_');
      expect(prompt).not.toContain('<section');
    });
  });
});
