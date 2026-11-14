import { describe, expect, it } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { ReleaseStaleAssignmentsUseCase } from './release-stale-assignments.use-case.js';


const held = { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd1', since: '2026-01-01T00:00:00.000Z' };

describe('ReleaseStaleAssignmentsUseCase', () => {
  it('releases every holder of every conversation on boot, as the server', async () => {
    const harness = createArtifactHarness([buildArtifact({ id: 'T-1', assignee: held }), buildArtifact({ id: 'T-2' })]);
    await harness.store.list('c2');
    const useCase = new ReleaseStaleAssignmentsUseCase(harness.store, harness.history, harness.events);

    await useCase.onModuleInit();

    expect(harness.store.artifactsOf().get('T-1')).toMatchObject({
      assignee: null,
      history: [{ kind: 'released', actor: { kind: 'system' }, summary: 'Released: the server restarted while Developer held it' }],
    });
    expect(harness.published.map(event => event.kind === 'saved' && event.artifact.id)).toEqual(['T-1']);
  });

  it('writes nothing when no artifact is held', async () => {
    const harness = createArtifactHarness([buildArtifact({ id: 'T-1' })]);

    await new ReleaseStaleAssignmentsUseCase(harness.store, harness.history, harness.events).execute();

    expect(harness.store.transactions).toBe(0);
  });

  it.each([new Error('disk full'), 'disk full'])('logs a failure instead of throwing (%#)', async (failure) => {
    const harness = createArtifactHarness([buildArtifact({ id: 'T-1', assignee: held })]);
    harness.store.transaction = () => Promise.reject(failure);

    await expect(new ReleaseStaleAssignmentsUseCase(harness.store, harness.history, harness.events).execute()).resolves.toBeUndefined();
  });
});
