import { describe, expect, it } from '@rstest/core';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';


describe('ArtifactDerivationService', () => {
  function setup() {
    return createArtifactHarness([
      buildArtifact({ id: 'F-1', type: 'feature', status: 'backlog' }),
      buildArtifact({ id: 'T-1', parentId: 'F-1', status: 'in_progress' }),
      buildArtifact({ id: 'T-2', parentId: 'F-1', status: 'ready' }),
      buildArtifact({ id: 'F-2', type: 'feature', status: 'in_progress' }),
      buildArtifact({ id: 'T-3', parentId: 'F-2', status: 'done' }),
      buildArtifact({ id: 'T-4', status: 'backlog', refinement: { business: 'skipped', technical: 'done' } }),
      buildArtifact({ id: 'T-5', status: 'backlog', refinement: { business: 'pending', technical: 'done' } }),
    ]);
  }

  it('should make a refined backlog task ready as the system, recording why', async () => {
    const { store, derivation } = setup();

    const settled = await store.transaction('c1', transaction => derivation.settleTask(transaction, transaction.find('T-4')!));

    expect(settled.artifact).toMatchObject({
      id: 'T-4',
      status: 'ready',
      history: [{ kind: 'updated', actor: { kind: 'system' }, summary: 'Ready: no refinement is pending', changes: [{ field: 'status', from: 'backlog', to: 'ready' }] }],
    });
    expect(settled.derived).toEqual([]);
    expect(store.artifactsOf().get('T-4')).toBe(settled.artifact);
  });

  it('should leave a task that owes a refinement in the backlog', async () => {
    const { store, derivation } = setup();
    const before = store.artifactsOf().get('T-5');

    const settled = await store.transaction('c1', transaction => derivation.settleTask(transaction, transaction.find('T-5')!));

    expect(settled).toEqual({ artifact: before, derived: [] });
    expect(store.artifactsOf().get('T-5')).toBe(before);
  });

  it('should settle the feature of a task and the feature it left', async () => {
    const { store, derivation } = setup();

    const settled = await store.transaction('c1', transaction => derivation.settleTask(transaction, transaction.find('T-1')!, 'F-2'));

    expect(settled.derived.map(feature => [feature.id, feature.status])).toEqual([['F-1', 'in_progress'], ['F-2', 'done']]);
    expect(store.artifactsOf().get('F-1')).toMatchObject({
      status: 'in_progress',
      history: [{ kind: 'updated', actor: { kind: 'system' }, summary: 'In progress: work on its tasks is under way', changes: [{ field: 'status', from: 'backlog', to: 'in_progress' }] }],
    });
    expect(store.artifactsOf().get('F-2')?.status).toBe('done');
  });

  it('should close a feature whose tasks are all closed', async () => {
    const { store, derivation } = setup();

    const settled = await store.transaction('c1', transaction => derivation.settleFeature(transaction, 'F-2'));

    expect(settled).toHaveLength(1);
    expect(store.artifactsOf().get('F-2')).toMatchObject({
      status: 'done',
      history: [{ actor: { kind: 'system' }, summary: 'Done: every task is done or cancelled', changes: [{ field: 'status', from: 'in_progress', to: 'done' }] }],
    });
  });

  it('should leave a missing feature and a standalone task alone', async () => {
    const { store, derivation } = setup();

    expect(await store.transaction('c1', transaction => derivation.settleFeature(transaction, null))).toEqual([]);
    expect(await store.transaction('c1', transaction => derivation.settleFeature(transaction, 'F-9'))).toEqual([]);
    expect(await store.transaction('c1', transaction => derivation.settleTask(transaction, transaction.find('T-5')!, null).derived)).toEqual([]);
  });
});
