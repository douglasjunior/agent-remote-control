import { describe, expect, it } from '@rstest/core';

import type { ArtifactActor, ArtifactHistoryEvent } from '../models/artifact.model.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { lastStatusChange, statusSetByUserWhileHeld } from './artifact-status.util.js';


const HOLDER = { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'd-1', since: '2026-01-01T10:00:00.000Z' };

function statusEvent(at: string, actor: ArtifactActor, to: string): ArtifactHistoryEvent {
  return { id: at, at, actor, kind: 'updated', summary: `Status → ${to}`, changes: [{ field: 'status', from: 'ready', to }] };
}

describe('artifact-status.util', () => {
  describe('lastStatusChange', () => {
    it('should return the latest event that changed the status', () => {
      const user = statusEvent('2026-01-01T11:00:00.000Z', { kind: 'user', channel: 'web' }, 'blocked');
      const artifact = buildArtifact({
        id: 'T-1',
        history: [
          statusEvent('2026-01-01T09:00:00.000Z', { kind: 'agent', role: 'CEO', roleName: 'CEO' }, 'in_progress'),
          user,
          { id: 'c', at: '2026-01-01T12:00:00.000Z', actor: { kind: 'system' }, kind: 'commented', summary: 'Commented', text: 'note' },
        ],
      });

      expect(lastStatusChange(artifact)).toEqual({ event: user, change: user.changes?.[0] });
    });

    it('should return nothing when the status never changed', () => {
      expect(lastStatusChange(buildArtifact({ id: 'T-1', history: [] }))).toBeUndefined();
    });
  });

  describe('statusSetByUserWhileHeld', () => {
    it('should be true when the user set the status after the holder took the artifact', () => {
      const artifact = buildArtifact({
        id: 'T-1',
        assignee: HOLDER,
        history: [statusEvent('2026-01-01T11:00:00.000Z', { kind: 'user', channel: 'web' }, 'cancelled')],
      });

      expect(statusSetByUserWhileHeld(artifact)).toBe(true);
    });

    it('should be false when the user set the status before the holder took the artifact', () => {
      const artifact = buildArtifact({
        id: 'T-1',
        assignee: HOLDER,
        history: [statusEvent('2026-01-01T09:00:00.000Z', { kind: 'user', channel: 'web' }, 'ready')],
      });

      expect(statusSetByUserWhileHeld(artifact)).toBe(false);
    });

    it('should be false when an agent set the status last', () => {
      const artifact = buildArtifact({
        id: 'T-1',
        assignee: HOLDER,
        history: [
          statusEvent('2026-01-01T11:00:00.000Z', { kind: 'user', channel: 'web' }, 'blocked'),
          statusEvent('2026-01-01T11:30:00.000Z', { kind: 'agent', role: 'CEO', roleName: 'CEO' }, 'in_progress'),
        ],
      });

      expect(statusSetByUserWhileHeld(artifact)).toBe(false);
    });

    it('should be false when nobody holds the artifact', () => {
      const artifact = buildArtifact({
        id: 'T-1',
        assignee: null,
        history: [statusEvent('2026-01-01T11:00:00.000Z', { kind: 'user', channel: 'web' }, 'cancelled')],
      });

      expect(statusSetByUserWhileHeld(artifact)).toBe(false);
    });
  });
});
