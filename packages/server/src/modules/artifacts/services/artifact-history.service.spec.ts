import { afterEach, describe, expect, it, rs } from '@rstest/core';

import { ArtifactHistoryService } from './artifact-history.service.js';


describe('ArtifactHistoryService', () => {
  afterEach(() => {
    rs.useRealTimers();
  });

  it('should stamp events with the current time and a fresh id, leaving out empty details', () => {
    rs.useFakeTimers({ now: new Date('2026-03-01T10:00:00.000Z') });
    const history = new ArtifactHistoryService();

    const first = history.event({ kind: 'system' }, 'updated', 'Nothing', { changes: [], text: '' });
    const second = history.event({ kind: 'user', channel: 'web' }, 'commented', 'Commented', { changes: [{ field: 'title', to: 'x' }], text: 'Hi' });

    expect(first).toEqual({ id: expect.any(String), at: '2026-03-01T10:00:00.000Z', actor: { kind: 'system' }, kind: 'updated', summary: 'Nothing' });
    expect(second).toMatchObject({ changes: [{ field: 'title', to: 'x' }], text: 'Hi' });
    expect(second.id).not.toBe(first.id);
    expect(history.now()).toBe('2026-03-01T10:00:00.000Z');
  });
});
