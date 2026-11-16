import { describe, expect, it, rs } from '@rstest/core';

import { buildArtifact } from '../testing/artifact.fixture.js';

import { ArtifactEventsService } from './artifact-events.service.js';


describe('ArtifactEventsService', () => {
  it('should deliver every event to every listener until it unsubscribes', () => {
    const events = new ArtifactEventsService();
    const first = rs.fn();
    const second = rs.fn();
    const unsubscribe = events.subscribe(first);
    events.subscribe(second);
    const saved = { kind: 'saved' as const, conversationId: 'c1', artifact: buildArtifact({ id: 'T-1' }) };

    events.publish([saved, { kind: 'deleted', conversationId: 'c1', id: 'T-2' }]);
    unsubscribe();
    events.publish([{ kind: 'deleted', conversationId: 'c1', id: 'T-3' }]);

    expect(first.mock.calls).toEqual([[saved], [{ kind: 'deleted', conversationId: 'c1', id: 'T-2' }]]);
    expect(second).toHaveBeenCalledTimes(3);
  });

  it('should keep notifying the other listeners when one throws', () => {
    const events = new ArtifactEventsService();
    const after = rs.fn();
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
