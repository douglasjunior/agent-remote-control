import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactHistoryEvent } from '../models/artifact.model.js';
import { ArtifactLimitsConfigService } from '../services/artifact-limits-config.service.js';
import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { AssignArtifactUseCase } from './assign-artifact.use-case.js';


const developer = { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd1' };
const held = { ...developer, since: '2026-01-01T00:00:00.000Z' };

const at = '2026-01-01T00:00:00.000Z';
const assigned = (n: number): ArtifactHistoryEvent[] => Array.from({ length: n }, (_, index) => ({
  id: `a${index}`, at, actor: { kind: 'agent', role: 'DEVELOPER', roleName: 'Developer' }, kind: 'assigned', summary: 'took it',
}));
const unfrozen: ArtifactHistoryEvent = {
  id: 'u', at, actor: { kind: 'user', channel: 'web' }, kind: 'updated', summary: 'Status frozen → ready', changes: [{ field: 'status', from: 'frozen', to: 'ready' }],
};

function setup(extra: ReturnType<typeof buildArtifact>[] = []) {
  const harness = createArtifactHarness([buildArtifact({ id: 'T-1' }), buildArtifact({ id: 'T-2', assignee: held }), ...extra]);
  return { ...harness, useCase: new AssignArtifactUseCase(harness.store, harness.history, harness.events, new ArtifactLimitsConfigService()) };
}

describe('AssignArtifactUseCase', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('freezes an artifact that reached the maximum of delegations instead of handing it over', async () => {
    vi.stubEnv('ARTIFACT_MAX_DELEGATIONS', '3');
    const { useCase, store, published } = setup([buildArtifact({ id: 'T-3', status: 'in_progress', history: assigned(3) })]);

    const outcome = await useCase.execute('c1', 'T-3', developer);

    expect(outcome).toEqual({ ok: false, error: 'T-3 is frozen: it went through too many delegations without being finished. Only the user takes it out of frozen; tell the user what is going wrong with it.' });
    expect(store.artifactsOf().get('T-3')).toMatchObject({
      status: 'frozen',
      assignee: null,
      history: expect.arrayContaining([expect.objectContaining({ actor: { kind: 'system' }, summary: 'Frozen after 3 delegations', changes: [{ field: 'status', from: 'in_progress', to: 'frozen' }] })]),
    });
    expect(published).toHaveLength(1);
  });

  it('refuses a frozen artifact and counts again from when the user unfroze it', async () => {
    vi.stubEnv('ARTIFACT_MAX_DELEGATIONS', '3');
    const { useCase, published } = setup([
      buildArtifact({ id: 'T-3', status: 'frozen', history: assigned(3) }),
      buildArtifact({ id: 'T-4', status: 'ready', history: [...assigned(3), unfrozen, ...assigned(2)] }),
    ]);

    expect(await useCase.execute('c1', 'T-3', developer)).toMatchObject({ ok: false, error: expect.stringContaining('T-3 is frozen') });
    expect(await useCase.execute('c1', 'T-4', developer)).toMatchObject({ ok: true });
    expect(published).toHaveLength(1);
  });

  it('never freezes when the limit is disabled', async () => {
    vi.stubEnv('ARTIFACT_MAX_DELEGATIONS', '0');
    const { useCase } = setup([buildArtifact({ id: 'T-3', history: assigned(50) })]);

    expect(await useCase.execute('c1', 'T-3', developer)).toMatchObject({ ok: true });
  });

  it('hands a free artifact to the delegation and records who took it', async () => {
    const { useCase, published } = setup();

    const outcome = await useCase.execute('c1', 'T-1', developer);

    expect(outcome).toMatchObject({
      ok: true,
      artifact: {
        assignee: { ...developer, since: expect.any(String) },
        history: [{ kind: 'assigned', actor: { kind: 'agent', role: 'DEVELOPER', roleName: 'Developer' }, summary: 'Developer took it' }],
      },
    });
    expect(published).toHaveLength(1);
  });

  it('keeps an artifact the same delegation already holds, without a new event', async () => {
    const { useCase, published } = setup();

    expect(await useCase.execute('c1', 'T-2', developer)).toMatchObject({ ok: true, artifact: { id: 'T-2', assignee: held } });
    expect(published).toEqual([]);
  });

  it.each([
    ['T-2', { ...developer, role: 'CODE_REVIEWER', roleName: 'Code Reviewer', delegationId: 'd2' }, 'T-2 is with Developer (DEVELOPER) right now; an artifact is with one agent at a time.'],
    ['T-9', developer, 'Unknown artifact "T-9".'],
  ])('refuses %s', async (id, assignee, error) => {
    const { useCase } = setup();

    expect(await useCase.execute('c1', id, assignee)).toEqual({ ok: false, error });
  });
});
