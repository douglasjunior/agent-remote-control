import { Logger } from '@nestjs/common';
import { describe, expect, it, rs } from '@rstest/core';

import type { Artifact, ArtifactStatus } from '../../artifacts/models/artifact.model.js';
import { buildArtifact } from '../../artifacts/testing/artifact.fixture.js';
import { createArtifactsService } from '../../artifacts/testing/artifacts-service.fixture.js';
import type { DelegationContract, IAgentRegistryPort } from '../ports/agent-registry.port.js';

import { DelegationStatusService } from './delegation-status.service.js';


const CONTRACTS: Record<string, DelegationContract> = {
  DEVELOPER: {
    artifact: 'required',
    statusFlow: {
      from: ['ready', 'in_progress', 'changes_requested'],
      start: 'in_progress',
      verdicts: { DONE: 'in_review', INCOMPLETE: 'in_progress' },
    },
  },
  CODE_REVIEWER: {
    artifact: 'required',
    statusFlow: { from: ['in_review'], verdicts: { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested' } },
  },
  PRODUCT_OWNER: { refines: 'business' },
  TECH_LEAD: { refines: 'technical' },
  GIT_OPS: {},
};

const DISPLAY_NAMES: Record<string, string> = { DEVELOPER: 'Developer Agent', CODE_REVIEWER: 'Code Reviewer Agent' };

const stub: Pick<IAgentRegistryPort, 'getDelegationContract' | 'getDisplayName' | 'listRoles'> = {
  getDelegationContract: role => CONTRACTS[role] ?? {},
  getDisplayName: role => DISPLAY_NAMES[role] ?? role,
  listRoles: () => Object.keys(CONTRACTS),
};
const registry = stub as IAgentRegistryPort;

function setup(status: ArtifactStatus = 'ready', overrides: Partial<Artifact> = {}) {
  const board = createArtifactsService({
    initial: [
      buildArtifact({ id: 'F-1', type: 'feature', status: 'in_progress' }),
      buildArtifact({ id: 'T-1', parentId: 'F-1', status, ...overrides }),
    ],
  });
  const service = new DelegationStatusService(board.service, registry);
  const task = async () => (await board.service.get('c1', 'T-1'))!;
  return { ...board, status: service, task };
}

describe('DelegationStatusService', () => {
  describe('refusal', () => {
    it('should accept a task whose status the role takes', async () => {
      const { status, task } = setup('in_progress');

      expect(status.refusal('DEVELOPER', await task())).toBeUndefined();
    });

    it('should never refuse a role without a status flow', async () => {
      const { status, task } = setup('backlog');

      expect(status.refusal('GIT_OPS', await task())).toBeUndefined();
    });

    it('should never refuse an artifact that is not a task', async () => {
      const { status, service } = setup();

      expect(status.refusal('CODE_REVIEWER', (await service.get('c1', 'F-1'))!)).toBeUndefined();
    });

    it('should name the business refinement and the roles that settle it for a backlog task', async () => {
      const { status, task } = setup('backlog', { refinement: { business: 'pending', technical: 'done' } });

      expect(status.refusal('DEVELOPER', await task())).toBe(
        'DEVELOPER works on T-1 only while it is ready, in_progress, changes_requested, and it is backlog right now. '
        + 'It still owes the business refinement (PRODUCT_OWNER): the agent that settles it comes first, so delegate T-1 to it, or set the refinement to skipped when the user does not want it.',
      );
    });

    it('should name the technical refinement for a backlog task', async () => {
      const { status, task } = setup('backlog', { refinement: { business: 'skipped', technical: 'pending' } });

      expect(status.refusal('DEVELOPER', await task())).toContain('It still owes the technical refinement (TECH_LEAD):');
    });

    it('should name both refinements for a backlog task that owes both', async () => {
      const { status, task } = setup('backlog', { refinement: { business: 'pending', technical: 'pending' } });

      expect(status.refusal('DEVELOPER', await task())).toContain('It still owes the business refinement (PRODUCT_OWNER) and the technical refinement (TECH_LEAD):');
    });

    it('should leave the roles out when no role settles the refinement', async () => {
      const { service, task } = setup('backlog', { refinement: { business: 'pending', technical: 'done' } });
      const lonely = new DelegationStatusService(
        service,
        { ...registry, listRoles: () => ['DEVELOPER'] } as IAgentRegistryPort,
      );

      expect(lonely.refusal('DEVELOPER', await task())).toContain('It still owes the business refinement:');
    });

    it('should say the status waits for another step and how to skip it', async () => {
      const { status, task } = setup('in_review');

      expect(status.refusal('DEVELOPER', await task())).toBe(
        'DEVELOPER works on T-1 only while it is ready, in_progress, changes_requested, and it is in_review right now. '
        + 'That status waits for another step: delegate that step first. When the user does not want it, skip it by setting the status to ready, which DEVELOPER takes.',
      );
    });

    it('should treat a backlog task that owes nothing as waiting for another step', async () => {
      const { status, task } = setup('backlog');

      expect(status.refusal('CODE_REVIEWER', await task())).toContain('That status waits for another step');
    });
  });

  describe('start', () => {
    it('should set the status the role starts in, by the system, with the reason', async () => {
      const { status, task } = setup('ready');

      await status.start('c1', 'T-1', 'DEVELOPER');

      const current = await task();
      const event = current.history.at(-1)!;
      expect(current.status).toBe('in_progress');
      expect(event.actor).toEqual({ kind: 'system' });
      expect(event.changes).toEqual([{ field: 'status', from: 'ready', to: 'in_progress' }]);
    });

    it('should record why the status changed in the history', async () => {
      const { status, task } = setup('ready');

      await status.start('c1', 'T-1', 'DEVELOPER');

      expect(JSON.stringify((await task()).history.at(-1))).toContain('Delegated to Developer Agent');
    });

    it('should leave a task already in the starting status alone', async () => {
      const { status, task } = setup('in_progress');

      await status.start('c1', 'T-1', 'DEVELOPER');

      expect((await task()).history).toHaveLength(0);
    });

    it('should leave the status alone for a role without a starting status', async () => {
      const { status, task } = setup('in_review');

      await status.start('c1', 'T-1', 'CODE_REVIEWER');

      expect((await task()).status).toBe('in_review');
    });

    it('should leave the status alone for a role without a status flow', async () => {
      const { status, task } = setup('ready');

      await status.start('c1', 'T-1', 'GIT_OPS');

      expect((await task()).status).toBe('ready');
    });

    it('should ignore an artifact that does not exist or is not a task', async () => {
      const { status, service } = setup('ready');

      await status.start('c1', 'T-9', 'DEVELOPER');
      await status.start('c1', 'F-1', 'DEVELOPER');

      expect((await service.get('c1', 'F-1'))!.status).toBe('in_progress');
      expect((await service.get('c1', 'F-1'))!.history).toHaveLength(0);
    });

    it('should log a refused change and not throw', async () => {
      const { status, service } = setup('ready');
      rs.spyOn(service, 'update').mockResolvedValue({ ok: false, error: 'refused' });
      const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(status.start('c1', 'T-1', 'DEVELOPER')).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith('Could not set T-1 to in_progress: refused');
      warn.mockRestore();
    });
  });

  describe('finish', () => {
    it('should set the status of the verdict, by the system, and return the verdict', async () => {
      const { status, task } = setup('in_progress');

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', 'DONE\nPushed the branch.')).resolves.toBe('DONE');

      const current = await task();
      const event = current.history.at(-1)!;
      expect(current.status).toBe('in_review');
      expect(event.actor).toEqual({ kind: 'system' });
      expect(JSON.stringify(event)).toContain('Developer Agent answered DONE');
    });

    it.each([
      ['DONE', 'DONE'],
      ['done', 'DONE'],
      ['**DONE**', 'DONE'],
      ['# DONE', 'DONE'],
      ['> `DONE`', 'DONE'],
      ['_DONE_', 'DONE'],
      ['Verdict: DONE', 'DONE'],
      ['**Verdict:** DONE', 'DONE'],
      ['  verdict : done  ', 'DONE'],
      ['DONE: pushed', 'DONE'],
      ['DONE.', 'DONE'],
      ['DONE - pushed', 'DONE'],
      ['\n\n  DONE\nmore', 'DONE'],
      ['incomplete: tests missing', 'INCOMPLETE'],
    ])('should read the verdict of %j', async (response, expected) => {
      const { status } = setup('in_progress');

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', response)).resolves.toBe(expected);
    });

    it.each([
      'DONE_WITH_CAVEATS',
      'DONEISH',
      'Not DONE',
      'The work is DONE',
      'Pushed.\nPushed again.\nDONE',
      '',
      '   \n  ',
    ])('should find no verdict in %j and change nothing', async (response) => {
      const { status, task } = setup('in_progress');

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', response)).resolves.toBeUndefined();

      expect((await task()).history).toHaveLength(0);
    });

    it('should match a verdict with an underscore in it', async () => {
      const { status, task } = setup('in_review');

      await expect(status.finish('c1', 'T-1', 'CODE_REVIEWER', '**CHANGES_REQUESTED**\nFix the tests.')).resolves.toBe('CHANGES_REQUESTED');

      expect((await task()).status).toBe('changes_requested');
    });

    it('should return the verdict without a change when the task is already in its status', async () => {
      const { status, task } = setup('in_progress');

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', 'INCOMPLETE')).resolves.toBe('INCOMPLETE');

      expect((await task()).history).toHaveLength(0);
    });

    it('should leave a status the user set while the agent held the task, and return the verdict', async () => {
      const { status, task, service } = setup('in_progress');
      await service.assign('c1', 'T-1', { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'd1' });
      await service.update('c1', 'T-1', { status: 'cancelled' }, { kind: 'user', channel: 'web' });

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', 'DONE')).resolves.toBe('DONE');

      expect((await task()).status).toBe('cancelled');
    });

    it('should apply the verdict when the user set the status before the agent took the task', async () => {
      rs.useFakeTimers();
      rs.setSystemTime(Date.parse('2026-03-01T10:00:00.000Z'));
      const { status, task, service } = setup('ready');
      await service.update('c1', 'T-1', { status: 'in_progress' }, { kind: 'user', channel: 'web' });
      rs.setSystemTime(Date.parse('2026-03-01T10:05:00.000Z'));
      await service.assign('c1', 'T-1', { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'd1' });

      await status.finish('c1', 'T-1', 'DEVELOPER', 'DONE');
      rs.useRealTimers();

      expect((await task()).status).toBe('in_review');
    });

    it('should find no verdict and change nothing for a role without a status flow', async () => {
      const { status, task } = setup('in_progress');

      await expect(status.finish('c1', 'T-1', 'GIT_OPS', 'DONE')).resolves.toBeUndefined();

      expect((await task()).history).toHaveLength(0);
    });

    it('should return the verdict for an artifact that does not exist or is not a task', async () => {
      const { status, service } = setup('in_progress');

      await expect(status.finish('c1', 'T-9', 'DEVELOPER', 'DONE')).resolves.toBe('DONE');
      await expect(status.finish('c1', 'F-1', 'DEVELOPER', 'DONE')).resolves.toBe('DONE');

      expect((await service.get('c1', 'F-1'))!.status).toBe('in_progress');
    });

    it('should log a refused change, not throw and still return the verdict', async () => {
      const { status, service } = setup('in_progress');
      rs.spyOn(service, 'update').mockResolvedValue({ ok: false, error: 'refused' });
      const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(status.finish('c1', 'T-1', 'DEVELOPER', 'DONE')).resolves.toBe('DONE');

      expect(warn).toHaveBeenCalledWith('Could not set T-1 to in_review: refused');
      warn.mockRestore();
    });
  });
});
