import { describe, expect, it } from '@rstest/core';

import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { DELEGATION_PROTOCOL_SKILL } from './delegation-protocol.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

describe('delegation-protocol skill', () => {
  const skill = DELEGATION_PROTOCOL_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR }));

  it('should be read by the CEO only', () => {
    expect(DELEGATION_PROTOCOL_SKILL).toMatchObject({ name: 'delegation-protocol', roles: ['CEO'] });
  });

  describe('the delegate tag', () => {
    it('should require the role and the summary and keep the summary away from the agent', () => {
      expect(skill).toContain('`role` and `summary` are required');
      expect(skill).toContain('The agent never sees it.');
    });

    it('should hold the artifact while the agent runs and work in its project', () => {
      expect(skill).toContain('the agent holds that artifact while it runs, receives its content, and works in its project folder');
    });
  });

  describe('the specification', () => {
    it('should name the step with an artifact and put what the task lacks on the task as a comment', () => {
      expect(skill).toContain('With `artifact`, name the step in a sentence or two');
      expect(skill).toContain('goes on it as an `<artifact_comment>` in the same response');
    });

    it('should make the specification self-contained without an artifact', () => {
      expect(skill).toContain('Without `artifact`, the agent knows only what you write');
    });

    it('should route the follow-up work to where an agent reports it put something', () => {
      expect(skill).toContain('When an agent reports where it put something, route the follow-up work there.');
    });
  });

  describe('project folder', () => {
    it('should show valid and invalid project folders', () => {
      expect(skill).toContain('| `project="my-app"` | yes |');
      expect(skill).toContain('| `project="my-app/backend"` | no |');
      expect(skill).toContain(`| \`project="${WORKSPACE_DIR}/my-app"\` | no |`);
    });

    it('should add a repository that is not in the workspace before working on it, through the workspace-navigation skill to confirm folders', () => {
      expect(skill).toContain(`\`${SKILL_NAMES.workspaceNavigation}\` skill`);
      expect(skill).toContain('starts by adding it, through the agent that adds repositories, delegated without a folder');
    });
  });

  describe('sessions', () => {
    it('should keep one session per task with an artifact and ignore the session attribute', () => {
      expect(skill).toContain('With `artifact`, an agent keeps one session per task');
      expect(skill).toContain('`session` is ignored');
    });

    it('should resume or start over without an artifact', () => {
      expect(skill).toContain('Without `artifact`, an agent keeps one session per project folder');
      expect(skill).toContain('`session="new"` starts over when the subject changes');
    });

    it('should start a new session when the coding agent of a role changed, restating the goal only without an artifact', () => {
      expect(skill).toContain('differs from the one in the last `[TEAM_PROFILES]` you received');
      expect(skill).toContain('With `artifact` it receives the whole task again, so nothing needs restating');
      expect(skill).toContain('restate the goal, the state of the work and the decisions already made');
      expect(skill).toContain('A change of model or effort alone keeps the session');
    });
  });

  describe('pipelines', () => {
    it('should pipeline several items through different roles, once per response', () => {
      expect(skill).toContain('each response moves every item one stage forward, with a different role per item');
      expect(skill).toContain('A role appears once per response');
    });

    it('should allow one agent that modifies files per project folder, read-only agents alongside it', () => {
      expect(skill).toContain('Only one agent that modifies files works in a project folder at a time, counting agents still running');
      expect(skill).toContain('Read-only agents may work alongside it');
    });

    it('should act on a result right away and end the turn once no agent is running', () => {
      expect(skill).toContain('Act on a result right away');
      expect(skill).toContain('The turn ends with your answer once no agent is left running.');
    });
  });

  describe('agent results', () => {
    it('should describe the result block and its optional attributes', () => {
      expect(skill).toContain('`<agent_result role="ROLE" project="project-folder" artifact="T-3" verdict="DONE" artifact_status="in_review"');
      expect(skill).toContain('`project`, `artifact`, `verdict` and `artifact_status` are absent when the delegation had none');
      expect(skill).toContain('`artifact_status_by="user"`');
    });

    it('should treat a result that opened with a verdict as a receipt, the report being on the task', () => {
      expect(skill).toContain('A result whose verdict moved its task on is a short receipt');
      expect(skill).toContain('A verdict that keeps the task where it was (more work to do, a block) comes whole');
      expect(skill).toContain('the report is on the task');
    });

    it('should delegate again after a failure that looks transient', () => {
      expect(skill).toContain('`status="failed"` means the agent stopped with an error');
      expect(skill).toContain('Delegate the work again when the error looks transient');
    });

    it('should not delegate a stopped artifact again unless the user asks', () => {
      expect(skill).toContain('`status="stopped"` means the user ended the work on its artifact');
      expect(skill).toContain('Do not delegate that artifact again unless the user asks');
      expect(skill).toContain('what the agent changed in the project stays as it left it');
    });

    it('should authorize reading a document an agent produced outside the workspaces root', () => {
      expect(skill).toContain('attach it to your answer and authorize reading that exact path for the agent that continues the work');
    });

    it('should relay an SSH public key verbatim and wait for the confirmation of the user', () => {
      expect(skill).toContain('relay the full key block verbatim in your answer and wait for the user\'s confirmation');
    });
  });

  describe('running agents', () => {
    it('should describe the team profiles and when they are repeated', () => {
      expect(skill).toContain('`[TEAM_PROFILES]` lists every agent of your team with its coding agent, model and effort, and whether it is idle or working');
      expect(skill).toContain('a prompt without it means nothing changed');
    });

    it('should trust the previous turn report over its own memory', () => {
      expect(skill).toContain('`[PREVIOUS_TURN]` reports how your last turn ended when it failed or was cancelled');
      expect(skill).toContain('Trust it over what your session remembers as sent');
    });

    it('should route the tasks of a board check or answer what each one waits for', () => {
      expect(skill).toContain('`[BOARD_CHECK]` arrives when you were about to end a turn leaving tasks it delegated in the middle of the flow');
      expect(skill).toContain('Your answer was not delivered: delegate their next step, or answer the user saying what each one waits for, and write that answer complete, with every attachment.');
    });

    it('should explain that delegating to a running role replaces its task', () => {
      expect(skill).toContain('Delegating to a role that is already working replaces its task with the new specification');
      expect(skill).toContain('Redirecting an agent on the artifact it already holds sends it only your new text, so that specification may run past the usual limit.');
    });
  });

  describe('access requests', () => {
    it('should route access requests through the user and a new delegation', () => {
      expect(skill).toContain('## Access Requests');
      expect(skill).toContain(`Paths outside \`${WORKSPACE_DIR}\`, write access, and anything holding secrets`);
      expect(skill).toContain('ask it with a `<question>` that explains the request and its risk');
      expect(skill).toContain('delegate again to the same agent, naming the exact path, the allowed mode');
    });
  });

  describe('agents only on the user\'s decision', () => {
    it('should suggest such an agent with a question and never relay its approval question', () => {
      expect(skill).toContain('## Agents Only on the User\'s Decision');
      expect(skill).toContain('suggest it with a `<question>`');
      expect(skill).toContain('Such a delegation is rejected in a turn that follows an agent result.');
      expect(skill).toContain('do not relay or answer that question for the user');
    });
  });

  describe('on the tools interface', () => {
    it('should put a fact the task lacks on it with artifact_comment before delegating, and keep the delegate tag', () => {
      const tools = DELEGATION_PROTOCOL_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR, agentInterface: 'tools' }));

      expect(tools).toContain('what it lacks goes on it with `artifact_comment` before you delegate:');
      expect(tools).toContain('`<delegate role="ROLE" summary="what the user reads" artifact="T-3"');
      expect(tools).not.toContain('<artifact_');
    });
  });
});
