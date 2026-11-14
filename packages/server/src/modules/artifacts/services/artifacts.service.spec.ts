import { describe, expect, it, vi } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';
import { AssignArtifactUseCase } from '../use-cases/assign-artifact.use-case.js';
import { CommentOnArtifactUseCase } from '../use-cases/comment-on-artifact.use-case.js';
import { CreateArtifactUseCase } from '../use-cases/create-artifact.use-case.js';
import { DeleteArtifactUseCase } from '../use-cases/delete-artifact.use-case.js';
import { ReleaseArtifactUseCase } from '../use-cases/release-artifact.use-case.js';
import { UpdateArtifactUseCase } from '../use-cases/update-artifact.use-case.js';

import { ArtifactLimitsConfigService } from './artifact-limits-config.service.js';
import { ArtifactsService } from './artifacts.service.js';


const user = { kind: 'user', channel: 'web' } as const;

function setup() {
  const harness = createArtifactHarness([
    buildArtifact({ id: 'F-1', type: 'feature', status: 'backlog', projectName: 'shop', createdAt: '2026-01-01T00:00:03.000Z' }),
    buildArtifact({ id: 'T-1', parentId: 'F-1', projectName: 'shop', createdAt: '2026-01-01T00:00:01.000Z' }),
    buildArtifact({ id: 'T-2', status: 'done', projectName: 'web', createdAt: '2026-01-01T00:00:02.000Z' }),
    buildArtifact({ id: 'T-3', status: 'cancelled', parentId: 'F-1', createdAt: '2026-01-01T00:00:04.000Z' }),
  ]);
  const { store, rules, history, events, workspace } = harness;
  const service = new ArtifactsService(
    store,
    new CreateArtifactUseCase(store, workspace, rules, history, events),
    new UpdateArtifactUseCase(store, workspace, rules, history, events),
    new CommentOnArtifactUseCase(store, history, events),
    new DeleteArtifactUseCase(store, history, events),
    new AssignArtifactUseCase(store, history, events, new ArtifactLimitsConfigService()),
    new ReleaseArtifactUseCase(store, history, events),
    events,
  );
  return { ...harness, service };
}

const ids = (artifacts: readonly { id: string }[]) => artifacts.map(artifact => artifact.id);

describe('ArtifactsService', () => {
  it.each([
    [undefined, ['T-1', 'F-1']],
    [{ statuses: 'all' as const }, ['T-1', 'T-2', 'F-1', 'T-3']],
    [{ statuses: ['done', 'cancelled'] as const }, ['T-2', 'T-3']],
    [{ types: ['feature'] as const }, ['F-1']],
    [{ parentId: 'F-1', statuses: 'all' as const }, ['T-1', 'T-3']],
    [{ parentId: null }, ['F-1']],
    [{ projectName: 'web', statuses: 'all' as const }, ['T-2']],
  ])('lists the artifacts matching %j in creation order', async (filter, expected) => {
    expect(ids(await setup().service.list('c1', filter))).toEqual(expected);
  });

  it('reads, creates, updates, comments, assigns, releases and removes through its use cases', async () => {
    const { service, store } = setup();
    const listener = vi.fn();
    const unsubscribe = service.onChange(listener);

    expect(await service.get('c1', 'T-1')).toBe(store.artifactsOf().get('T-1'));
    expect(await service.create('c1', { type: 'task', title: 'New', projectName: 'shop' }, user)).toMatchObject({ ok: true, artifact: { id: 'T-4' } });
    expect(await service.update('c1', 'T-2', { status: 'ready' }, user)).toEqual({ ok: true, artifact: store.artifactsOf().get('T-2') });
    expect(await service.update('c1', 'T-9', { status: 'ready' }, user)).toEqual({ ok: false, error: 'Unknown artifact "T-9".' });
    expect(await service.comment('c1', 'T-2', 'Hi', user)).toMatchObject({ ok: true });
    expect(await service.assign('c1', 'T-2', { role: 'DEVELOPER', roleName: 'Dev', delegationId: 'd' })).toMatchObject({ ok: true });
    await service.release('c1', 'T-2', 'd', 'finished');
    expect(store.artifactsOf().get('T-2')?.assignee).toBeNull();
    expect(await service.remove('c1', 'T-2', user)).toEqual({ ok: true });
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(6);
  });
});
