import { describe, expect, it, vi } from 'vitest';

import { buildArtifact } from '../testing/artifact.fixture.js';

import { ArtifactEventsService } from './artifact-events.service.js';


describe('ArtifactEventsService', () => {
  it('delivers every event to every listener until it unsubscribes', () => {
    const events = new ArtifactEventsService();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = events.subscribe(first);
    events.subscribe(second);
    const saved = { kind: 'saved' as const, conversationId: 'c1', artifact: buildArtifact({ id: 'T-1' }) };

    events.publish([saved, { kind: 'deleted', conversationId: 'c1', id: 'T-2' }]);
    unsubscribe();
    events.publish([{ kind: 'deleted', conversationId: 'c1', id: 'T-3' }]);

    expect(first.mock.calls).toEqual([[saved], [{ kind: 'deleted', conversationId: 'c1', id: 'T-2' }]]);
    expect(second).toHaveBeenCalledTimes(3);
  });

  it('keeps notifying the other listeners when one throws', () => {
    const events = new ArtifactEventsService();
    const after = vi.fn();
    events.subscribe(() => {
      throw new Error('boom');
    });
    events.subscribe(() => {
      throw 'plain';
    });
    events.subscribe(after);

    events.publish([{ kind: 'deleted', conversationId: 'c1', id: 'T-1' }]);

    expect(after).toHaveBeenCalledWith({ kind: 'deleted', conversationId: 'c1', id: 'T-1' });
  });
});
