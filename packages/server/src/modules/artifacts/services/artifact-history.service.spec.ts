import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactHistoryService } from './artifact-history.service.js';


describe('ArtifactHistoryService', () => {
  afterEach(() => vi.useRealTimers());

  it('stamps events with the current time and a fresh id, leaving out empty details', () => {
    vi.useFakeTimers({ now: new Date('2026-03-01T10:00:00.000Z') });
    const history = new ArtifactHistoryService();

    const first = history.event({ kind: 'system' }, 'updated', 'Nothing', { changes: [], text: '' });
    const second = history.event({ kind: 'user', channel: 'web' }, 'commented', 'Commented', { changes: [{ field: 'title', to: 'x' }], text: 'Hi' });

    expect(first).toEqual({ id: expect.any(String), at: '2026-03-01T10:00:00.000Z', actor: { kind: 'system' }, kind: 'updated', summary: 'Nothing' });
    expect(second).toMatchObject({ changes: [{ field: 'title', to: 'x' }], text: 'Hi' });
    expect(second.id).not.toBe(first.id);
    expect(history.now()).toBe('2026-03-01T10:00:00.000Z');
  });
});
