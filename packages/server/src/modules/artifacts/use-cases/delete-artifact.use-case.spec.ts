import { describe, expect, it } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { DeleteArtifactUseCase } from './delete-artifact.use-case.js';


const user = { kind: 'user', channel: 'web' } as const;
const assignee = { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd', since: '2026-01-01T00:00:00.000Z' };

function setup() {
  const harness = createArtifactHarness([
    buildArtifact({ id: 'F-1', type: 'feature' }),
    buildArtifact({ id: 'T-1', parentId: 'F-1' }),
    buildArtifact({ id: 'T-2', dependsOn: ['T-1', 'T-3'] }),
    buildArtifact({ id: 'T-3' }),
    buildArtifact({ id: 'T-4', dependsOn: ['T-3'] }),
    buildArtifact({ id: 'T-5', assignee }),
  ]);
  return { ...harness, useCase: new DeleteArtifactUseCase(harness.store, harness.history, harness.events) };
}

describe('DeleteArtifactUseCase', () => {
  it('removes the artifact and the dependencies on it, telling why in the history of the others', async () => {
    const { useCase, store, published } = setup();

    expect(await useCase.execute('c1', 'T-3', user)).toEqual({ ok: true });

    expect(store.artifactsOf().has('T-3')).toBe(false);
    expect(store.artifactsOf().get('T-2')).toMatchObject({
      dependsOn: ['T-1'],
      history: [{ kind: 'updated', actor: user, summary: 'Dependency on T-3 removed: it was deleted', changes: [{ field: 'depends_on', from: 'T-1, T-3', to: 'T-1' }] }],
    });
    expect(store.artifactsOf().get('T-4')).toMatchObject({ dependsOn: [], history: [{ changes: [{ from: 'T-3', to: 'none' }] }] });
    expect(published.map(event => event.kind === 'deleted' ? event.id : event.artifact.id)).toEqual(['T-3', 'T-2', 'T-4']);
  });

  it.each([
    ['T-9', 'Unknown artifact "T-9".'],
    ['F-1', 'F-1 still has T-1 under it: move or delete them first.'],
    ['T-5', 'T-5 is with Developer; wait until it is released.'],
  ])('refuses to delete %s', async (id, error) => {
    const { useCase, published, store } = setup();

    expect(await useCase.execute('c1', id, user)).toEqual({ ok: false, error });
    expect(published).toEqual([]);
    expect(store.artifactsOf().size).toBe(6);
  });
});
