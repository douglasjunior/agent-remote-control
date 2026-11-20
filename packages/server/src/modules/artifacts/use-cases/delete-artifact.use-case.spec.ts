import { describe, expect, it } from '@rstest/core';

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
    buildArtifact({ id: 'F-2', type: 'feature', status: 'in_progress' }),
    buildArtifact({ id: 'T-6', parentId: 'F-2', status: 'done' }),
    buildArtifact({ id: 'T-7', parentId: 'F-2', status: 'ready' }),
    buildArtifact({ id: 'T-8', parentId: 'F-2', status: 'cancelled' }),
  ]);
  return { ...harness, useCase: new DeleteArtifactUseCase(harness.store, harness.history, harness.events, harness.derivation) };
}

describe('DeleteArtifactUseCase', () => {
  it('should remove the artifact and the dependencies on it, telling why in the history of the others', async () => {
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
  ])('should refuse to delete %s', async (id, error) => {
    const { useCase, published, store } = setup();

    expect(await useCase.execute('c1', id, user)).toEqual({ ok: false, error });
    expect(published).toEqual([]);
    expect(store.artifactsOf().size).toBe(10);
  });

  it('should finish the feature when the removed task was its last open one', async () => {
    const { useCase, store, published } = setup();

    expect(await useCase.execute('c1', 'T-7', user)).toEqual({ ok: true });

    expect(store.artifactsOf().get('F-2')).toMatchObject({
      status: 'done',
      history: [{ kind: 'updated', actor: { kind: 'system' }, summary: 'Done: every task is done or cancelled', changes: [{ field: 'status', from: 'in_progress', to: 'done' }] }],
    });
    expect(published).toEqual([
      { kind: 'deleted', conversationId: 'c1', id: 'T-7' },
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('F-2') },
    ]);
  });

  it('should leave the feature alone when the removed task changes nothing for it', async () => {
    const { useCase, store, published } = setup();

    await useCase.execute('c1', 'T-1', user);

    expect(store.artifactsOf().get('F-1')?.status).toBe('ready');
    expect(published.map(event => event.kind === 'deleted' ? event.id : event.artifact.id)).toEqual(['T-1', 'T-2']);
  });

  it('should not finish a feature whose tasks are all cancelled once the removed one is gone', async () => {
    const { useCase, store } = setup();
    await useCase.execute('c1', 'T-6', user);

    await useCase.execute('c1', 'T-7', user);

    expect(store.artifactsOf().get('F-2')?.status).toBe('in_progress');
  });
});
