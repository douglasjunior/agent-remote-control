import { describe, expect, it } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { ReleaseArtifactUseCase } from './release-artifact.use-case.js';


const held = { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd1', since: '2026-01-01T00:00:00.000Z' };

function setup() {
  const harness = createArtifactHarness([buildArtifact({ id: 'T-1', assignee: held }), buildArtifact({ id: 'T-2' })]);
  return { ...harness, useCase: new ReleaseArtifactUseCase(harness.store, harness.history, harness.events) };
}

describe('ReleaseArtifactUseCase', () => {
  it('frees the artifact the delegation holds, recording how the work ended', async () => {
    const { useCase, store, published } = setup();

    await useCase.execute('c1', 'T-1', 'd1', 'finished');

    expect(store.artifactsOf().get('T-1')).toMatchObject({
      assignee: null,
      history: [{ kind: 'released', actor: { kind: 'agent', role: 'DEVELOPER' }, summary: 'Developer released it: finished' }],
    });
    expect(published).toHaveLength(1);
  });

  it.each([['T-1', 'd2'], ['T-2', 'd1'], ['T-9', 'd1']])('leaves %s alone for delegation %s', async (id, delegationId) => {
    const { useCase, store, published } = setup();

    await useCase.execute('c1', id, delegationId, 'finished');

    expect(store.artifactsOf().get('T-1')?.assignee).toEqual(held);
    expect(published).toEqual([]);
  });
});
