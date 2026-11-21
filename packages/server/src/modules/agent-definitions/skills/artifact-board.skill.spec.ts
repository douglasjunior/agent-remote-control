import { describe, expect, it } from '@rstest/core';

import { ARTIFACT_STATUSES } from '../../artifacts/constants/artifact-catalog.constant.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { ARTIFACT_BOARD_SKILL } from './artifact-board.skill.js';


describe('artifact-board skill', () => {
  const skill = ARTIFACT_BOARD_SKILL.buildContent(skillContext({ workspaceDir: '/home/user/workspaces' }));

  it('should be read by the CEO only', () => {
    expect(ARTIFACT_BOARD_SKILL).toMatchObject({ name: 'artifact-board', roles: ['CEO'] });
  });

  describe('adding a request', () => {
    it('should add a request to an open artifact whose status still allows it', () => {
      expect(skill).toContain('(`backlog`, `ready`, or `changes_requested` for a correction)');
      expect(skill).toContain('`<section name="overview" mode="append">`');
    });

    it('should comment instead of appending when an agent holds the artifact', () => {
      expect(skill).toContain('and comment on it when someone does');
    });

    it('should create a new task that depends on work that already moved past review', () => {
      expect(skill).toContain('create a new task that depends on it instead of reopening it');
    });

    it('should list the finished work too with the all status', () => {
      expect(skill).toContain('`<artifact_list status="all"/>`');
    });
  });

  describe('statuses', () => {
    it('should let the server move the statuses and keep a feature in step with its tasks', () => {
      expect(skill).toContain('The server moves a task from the delegations and their verdicts');
      expect(skill).toContain('keeps a feature in step with its tasks');
    });

    it('should keep a task ready only while no refinement is pending, and park a refined task with blocked', () => {
      expect(skill).toContain('keeps a task `ready` exactly while no refinement is pending (a `ready` task whose refinement is set back to `pending` returns to the `backlog`)');
      expect(skill).toContain('It is also how a refined task is parked, since `backlog` and `ready` follow its refinements.');
    });

    it('should say that a tested task waits for the merge', () => {
      expect(skill).toContain('- A task that passed its test is `tested`: it waits for the merge, and `done` once merged or left for the user.');
    });

    it('should skip a step the user does not want by setting the status that step would have left', () => {
      expect(skill).toContain('<artifact_update id="T-3" status="approved" note="the user waived the review"/>');
    });

    it('should say what blocked and frozen mean and who takes a task out of them', () => {
      expect(skill).toContain('`blocked` waits on something outside the team: say what in a comment');
      expect(skill).toContain('`frozen` is set by the server on a task that went through too many delegations. Only the user takes a task out of it');
    });

    it('should close an artifact with done or cancelled and leave the status alone after a result without a verdict', () => {
      expect(skill).toContain('`done` and `cancelled` close an artifact');
      expect(skill).toContain('A failed result, or one without a verdict, leaves the status as it was.');
    });

    it('should name only statuses of the catalog', () => {
      const named = [...skill.split('## Request Grammar')[0]!.matchAll(/status="([a-z_]+)"/g)].map(match => match[1]!).filter(status => status !== 'all');

      expect(named.length).toBeGreaterThan(0);
      for (const status of named) {
        expect(ARTIFACT_STATUSES as readonly string[]).toContain(status);
      }
    });
  });

  describe('dependencies and parallel work', () => {
    it('should link siblings and wait for the tasks in depends_on', () => {
      expect(skill).toContain('Dependencies link siblings');
      expect(skill).toContain('A task waits for the tasks in its `depends_on`');
    });

    it('should move free tasks in parallel and keep an artifact with one agent at a time', () => {
      expect(skill).toContain('Tasks free of waits, and that need different agents, move in parallel');
      expect(skill).toContain('An artifact is with one agent at a time');
    });
  });

  it('should carry the full request grammar written for the board access of the CEO', () => {
    expect(skill).toContain('## Request Grammar');
    expect(skill).toContain('`<artifact_list type="feature"');
    expect(skill).toContain('<artifact_create type="task"');
  });

  describe('on the tools interface', () => {
    const tools = ARTIFACT_BOARD_SKILL.buildContent(skillContext({ agentInterface: 'tools' }));

    it('should keep the statuses and dependencies and name the tools instead of the requests', () => {
      expect(tools).toContain('## Statuses');
      expect(tools).toContain('## Dependencies and Parallel Work');
      expect(tools).toContain('`artifact_list` with the status `all` lists the finished work too');
      expect(tools).toContain('append it to the `overview` when nobody holds the artifact');
      expect(tools).toContain('set the status that step would have left with `artifact_update`, saying why in its `note`');
    });

    it('should hold the tools of the CEO in place of the request grammar', () => {
      expect(tools).toContain('## Working on the Board\nThe work of this conversation lives on a board');
      expect(tools).toContain('You read and change the board with the tools of the `arc` MCP server');
      expect(tools).toContain('- `artifact_create` creates a feature or a task and returns its id');
      expect(tools).not.toContain('## Request Grammar');
      expect(tools).not.toContain('<artifact_');
    });
  });
});
