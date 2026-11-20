import { describe, expect, it } from '@rstest/core';

import type { ArtifactChanges } from '../models/artifact.model.js';
import { createArtifactHarness } from '../testing/artifact-harness.js';
import { ARTIFACT_AT, buildArtifact } from '../testing/artifact.fixture.js';

import { UpdateArtifactUseCase } from './update-artifact.use-case.js';


const ceo = { kind: 'agent', role: 'CEO', roleName: 'CEO' } as const;
const pr = 'https://github.com/o/r/pull/7';

function setup() {
  const harness = createArtifactHarness([
    buildArtifact({ id: 'F-2', type: 'feature', projectName: 'web' }),
    buildArtifact({ id: 'T-5', parentId: 'F-2', projectName: 'web' }),
    buildArtifact({ id: 'F-1', type: 'feature' }),
    buildArtifact({
      id: 'T-1',
      parentId: 'F-1',
      dependsOn: ['T-2'],
      branch: 'feat/a',
      sections: { overview: 'Why', test_cases: 'Case 1' },
      pullRequests: [{ url: pr, title: 'Login', state: 'open', addedAt: ARTIFACT_AT }],
    }),
    buildArtifact({ id: 'T-2', parentId: 'F-1' }),
    buildArtifact({ id: 'T-3' }),
  ]);
  return { ...harness, useCase: new UpdateArtifactUseCase(harness.store, harness.workspace, harness.rules, harness.history, harness.events, harness.derivation) };
}

describe('UpdateArtifactUseCase', () => {
  it('should apply every change, record each field and publish the artifact', async () => {
    const { useCase, published, store } = setup();

    const outcome = await useCase.execute('c1', 'T-1', {
      title: ' Login API ',
      status: 'in_review',
      parentId: 'F-2',
      projectName: 'web',
      dependsOn: ['T-5'],
      refinement: { business: 'done', design: 'pending', technical: 'skipped' },
      branch: ' feat/b ',
      sections: [
        { section: 'overview', content: 'More', mode: 'append' },
        { section: 'test_cases', content: '', mode: 'replace' },
        { section: 'technical_solution', content: 'Use JWT', mode: 'append' },
        { section: 'glossary', content: 'Term', mode: 'replace' },
      ],
      pullRequests: [{ url: pr, state: 'merged' }, { url: 'https://github.com/o/r/pull/8', title: ' Fix ' }],
      note: ' PR merged ',
    }, ceo);

    expect(outcome).toMatchObject({
      ok: true,
      artifact: {
        title: 'Login API',
        status: 'in_review',
        parentId: 'F-2',
        projectName: 'web',
        dependsOn: ['T-5'],
        refinement: { business: 'done', design: 'pending', technical: 'skipped' },
        branch: 'feat/b',
        sections: { overview: 'Why\n\nMore', technical_solution: 'Use JWT', glossary: 'Term' },
        pullRequests: [
          { url: pr, title: 'Login', state: 'merged', addedAt: ARTIFACT_AT },
          { url: 'https://github.com/o/r/pull/8', title: 'Fix', state: 'open', addedAt: expect.any(String) },
        ],
      },
    });
    const event = store.artifactsOf().get('T-1')!.history.at(-1);
    expect(event).toMatchObject({ kind: 'updated', actor: ceo, text: 'PR merged' });
    expect(event?.summary).toBe('Status ready → in_review; updated title, parent, project, depends on, design refinement, technical refinement, branch, pull request, overview, test cases, technical solution, glossary');
    expect(event?.changes).toEqual([
      { field: 'title', from: 'Artifact T-1', to: 'Login API' },
      { field: 'status', from: 'ready', to: 'in_review' },
      { field: 'parent', from: 'F-1', to: 'F-2' },
      { field: 'project', from: 'shop', to: 'web' },
      { field: 'depends_on', from: 'T-2', to: 'T-5' },
      { field: 'business_refinement', from: 'done', to: 'done' },
      { field: 'design_refinement', from: 'done', to: 'pending' },
      { field: 'technical_refinement', from: 'done', to: 'skipped' },
      { field: 'branch', from: 'feat/a', to: 'feat/b' },
      { field: 'pull_request', from: 'open', to: `${pr} (merged)` },
      { field: 'pull_request', to: 'https://github.com/o/r/pull/8 (open)' },
      { field: 'section:overview', to: 'appended' },
      { field: 'section:test_cases', to: 'cleared' },
      { field: 'section:technical_solution', to: 'replaced' },
      { field: 'section:glossary', to: 'replaced' },
    ].filter(change => change.field !== 'business_refinement'));
    expect(published).toEqual([
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('T-1') },
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('F-2') },
    ]);
    expect(store.artifactsOf().get('F-2')?.status).toBe('in_progress');
  });

  it('should summarize a change without status by its fields', async () => {
    const { useCase, store } = setup();

    await useCase.execute('c1', 'T-1', { parentId: null, projectName: 'web', dependsOn: [], branch: null }, ceo);

    expect(store.artifactsOf().get('T-1')!.history.at(-1)).toMatchObject({
      summary: 'Updated parent, project, depends on, branch',
      changes: [
        { field: 'parent', from: 'F-1', to: 'none' },
        { field: 'project', from: 'shop', to: 'web' },
        { field: 'depends_on', from: 'T-2', to: 'none' },
        { field: 'branch', from: 'feat/a', to: 'none' },
      ],
    });
  });

  it('should read a status change alone as the summary', async () => {
    const { useCase, store } = setup();

    await useCase.execute('c1', 'T-3', { status: 'done', branch: '  ', parentId: null }, ceo);

    expect(store.artifactsOf().get('T-3')!.history.at(-1)?.summary).toBe('Status ready → done');
  });

  it.each<[string, ArtifactChanges]>([
    ['the same values', { title: 'Artifact T-1', status: 'ready', parentId: 'F-1', projectName: 'shop', dependsOn: ['T-2'], branch: 'feat/a', refinement: { business: 'done' } }],
    ['sections that end up the same', { sections: [{ section: 'overview', content: 'Why', mode: 'replace' }, { section: 'scope', content: ' ', mode: 'append' }] }],
    ['a pull request already recorded', { pullRequests: [{ url: pr, title: 'Login' }] }],
  ])('should record nothing for %s', async (_name, changes) => {
    const { useCase, published, store } = setup();
    const before = store.artifactsOf().get('T-1');

    expect(await useCase.execute('c1', 'T-1', changes, ceo)).toEqual({ ok: true, artifact: before, changed: false });
    expect(published).toEqual([]);
  });

  it.each<[string, string, ArtifactChanges, string]>([
    ['an unknown artifact', 'T-9', { status: 'done' }, 'Unknown artifact "T-9".'],
    ['a blank title', 'T-1', { title: ' ' }, 'An artifact needs a title.'],
    ['a parent of the wrong type', 'T-1', { parentId: 'T-2' }, 'A task goes under a feature, and T-2 is a task.'],
    ['an unknown project', 'T-1', { projectName: 'api' }, 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
    ['a project apart from the feature', 'T-1', { projectName: 'web' }, 'F-1 belongs to project "shop", so its tasks belong there too, not to "web". Work in another project goes in a feature of that project.'],
    ['a feature of another project', 'T-2', { parentId: 'F-2' }, 'F-2 belongs to project "web", so its tasks belong there too, not to "shop". Work in another project goes in a feature of that project.'],
    ['moving a feature with tasks to another project', 'F-1', { projectName: 'web' }, 'F-1 has T-1, T-2 under it, which stay in its project; move them first.'],
    ['a dependency cycle', 'T-2', { dependsOn: ['T-1'] }, 'T-2 cannot depend on T-1, because T-1 already depends on T-2.'],
    ['a dependency outside the feature', 'T-2', { dependsOn: ['T-3'] }, 'T-3 cannot be a dependency here: a task depends only on other tasks of its feature, F-1.'],
    ['a move that leaves a dependent sibling behind', 'T-2', { parentId: null }, 'T-1 depends on T-2, and dependencies stay among siblings: remove that dependency before moving T-2.'],
    ['an invalid pull request', 'T-1', { status: 'done', pullRequests: [{ url: 'nope' }] }, '"nope" is not a pull request URL: use its full http(s) address.'],
  ])('should refuse %s, changing nothing', async (_name, id, changes, error) => {
    const { useCase, published, store } = setup();
    const before = store.artifactsOf().get('T-1');

    expect(await useCase.execute('c1', id, changes, ceo)).toEqual({ ok: false, error });
    expect(store.artifactsOf().get('T-1')).toBe(before);
    expect(published).toEqual([]);
  });
});

describe('UpdateArtifactUseCase derived statuses', () => {
  const pending = { business: 'pending', design: 'skipped', technical: 'pending' } as const;
  const businessPending = { business: 'pending', design: 'skipped', technical: 'done' } as const;

  function setupBoard() {
    const harness = createArtifactHarness([
      buildArtifact({ id: 'T-1', status: 'backlog', refinement: pending }),
      buildArtifact({ id: 'T-2', status: 'backlog', refinement: businessPending }),
      buildArtifact({ id: 'T-3', status: 'backlog', refinement: businessPending }),
      buildArtifact({ id: 'T-4', status: 'blocked', refinement: businessPending }),
      buildArtifact({ id: 'T-5' }),
      buildArtifact({ id: 'F-1', type: 'feature', status: 'backlog', refinement: pending }),
      buildArtifact({ id: 'F-2', type: 'feature', status: 'backlog' }),
      buildArtifact({ id: 'T-6', parentId: 'F-2', status: 'ready' }),
      buildArtifact({ id: 'T-7', parentId: 'F-2', status: 'ready' }),
      buildArtifact({ id: 'F-3', type: 'feature', status: 'ready' }),
      buildArtifact({ id: 'T-8', parentId: 'F-3', status: 'ready' }),
      buildArtifact({ id: 'F-4', type: 'feature', status: 'done' }),
      buildArtifact({ id: 'T-9', parentId: 'F-4', status: 'done' }),
      buildArtifact({ id: 'T-10', parentId: 'F-4', status: 'cancelled' }),
      buildArtifact({ id: 'F-5', type: 'feature', status: 'in_progress' }),
      buildArtifact({ id: 'T-11', parentId: 'F-5', status: 'in_progress' }),
      buildArtifact({ id: 'T-12', parentId: 'F-5', status: 'done' }),
      buildArtifact({ id: 'F-6', type: 'feature', status: 'in_progress' }),
      buildArtifact({ id: 'T-13', parentId: 'F-6', status: 'in_review' }),
      buildArtifact({ id: 'T-14', parentId: 'F-6', status: 'cancelled' }),
      buildArtifact({ id: 'F-7', type: 'feature', status: 'in_progress' }),
      buildArtifact({ id: 'T-15', parentId: 'F-7', status: 'done' }),
      buildArtifact({ id: 'T-16', parentId: 'F-7', status: 'ready' }),
      buildArtifact({ id: 'F-8', type: 'feature', status: 'blocked' }),
      buildArtifact({ id: 'T-17', parentId: 'F-8', status: 'ready' }),
      buildArtifact({ id: 'F-9', type: 'feature', status: 'frozen' }),
      buildArtifact({ id: 'T-18', parentId: 'F-9', status: 'ready' }),
      buildArtifact({ id: 'F-10', type: 'feature', status: 'cancelled' }),
      buildArtifact({ id: 'T-19', parentId: 'F-10', status: 'ready' }),
      buildArtifact({ id: 'F-11', type: 'feature', status: 'ready' }),
    ]);
    return { ...harness, useCase: new UpdateArtifactUseCase(harness.store, harness.workspace, harness.rules, harness.history, harness.events, harness.derivation) };
  }

  const statusOf = (store: { artifactsOf(): Map<string, { status: string }> }, id: string) => store.artifactsOf().get(id)?.status;

  it.each([
    ['done', { business: 'done' }],
    ['skipped', { business: 'skipped' }],
  ] as const)('should make a task ready when its last pending refinement is %s', async (_name, refinement) => {
    const { useCase, store, published } = setupBoard();

    const outcome = await useCase.execute('c1', 'T-2', { refinement }, ceo);

    const task = store.artifactsOf().get('T-2')!;
    expect(outcome).toEqual({ ok: true, artifact: task, changed: true });
    expect(task.status).toBe('ready');
    expect(task.history).toHaveLength(2);
    expect(task.history[0]).toMatchObject({ actor: ceo, summary: 'Updated business refinement' });
    expect(task.history[1]).toMatchObject({
      kind: 'updated',
      actor: { kind: 'system' },
      summary: 'Ready: no refinement is pending',
      changes: [{ field: 'status', from: 'backlog', to: 'ready' }],
    });
    expect(published).toEqual([{ kind: 'saved', conversationId: 'c1', artifact: task }]);
  });

  it('should keep a task in the backlog while a refinement is pending', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-1', { refinement: { business: 'done' } }, ceo);

    expect(statusOf(store, 'T-1')).toBe('backlog');
    expect(store.artifactsOf().get('T-1')?.history).toHaveLength(1);
  });

  it('should make a task ready when it is sent back to the backlog owing no refinement', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-5', { status: 'backlog' }, ceo);

    expect(statusOf(store, 'T-5')).toBe('ready');
    expect(store.artifactsOf().get('T-5')?.history.map(event => event.summary)).toEqual(['Status ready → backlog', 'Ready: no refinement is pending']);
  });

  it('should send a ready task back to the backlog when a refinement is set back to pending, recording why', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-5', { refinement: { technical: 'pending' } }, ceo);

    const task = store.artifactsOf().get('T-5')!;
    expect(task.status).toBe('backlog');
    expect(task.history[1]).toMatchObject({
      kind: 'updated',
      actor: { kind: 'system' },
      summary: 'Back to the backlog: a refinement is pending',
      changes: [{ field: 'status', from: 'ready', to: 'backlog' }],
    });
  });

  it('should send a task set to ready while it owes a refinement back to the backlog', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-1', { status: 'ready' }, ceo);

    expect(statusOf(store, 'T-1')).toBe('backlog');
  });

  it('should leave alone a task parked out of the backlog and ready, whatever it owes', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-4', { refinement: { business: 'done' } }, ceo);

    expect(statusOf(store, 'T-4')).toBe('blocked');
  });

  it('should not make a feature ready when its refinements are settled', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'F-1', { refinement: { business: 'done', design: 'skipped', technical: 'skipped' } }, ceo);

    expect(statusOf(store, 'F-1')).toBe('backlog');
  });

  it.each([
    ['backlog', 'T-6', 'F-2'],
    ['ready', 'T-8', 'F-3'],
  ])('should put a %s feature in progress when one of its tasks starts', async (from, taskId, featureId) => {
    const { useCase, store, published } = setupBoard();

    await useCase.execute('c1', taskId, { status: 'in_progress' }, ceo);

    const feature = store.artifactsOf().get(featureId)!;
    expect(feature.status).toBe('in_progress');
    expect(feature.history).toEqual([
      expect.objectContaining({
        kind: 'updated',
        actor: { kind: 'system' },
        summary: 'In progress: work on its tasks is under way',
        changes: [{ field: 'status', from, to: 'in_progress' }],
      }),
    ]);
    expect(published.map(event => event.kind === 'saved' && event.artifact.id)).toEqual([taskId, featureId]);
  });

  it('should reopen a done feature when a task of it is open again', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-10', { status: 'ready' }, ceo);

    expect(statusOf(store, 'F-4')).toBe('in_progress');
    expect(store.artifactsOf().get('F-4')?.history.at(-1)?.changes).toEqual([{ field: 'status', from: 'done', to: 'in_progress' }]);
  });

  it.each([
    ['done', 'T-11', 'done', 'F-5'],
    ['cancelled', 'T-11', 'cancelled', 'F-5'],
  ] as const)('should finish a feature when its last open task is %s', async (_name, taskId, status, featureId) => {
    const { useCase, store, published } = setupBoard();

    await useCase.execute('c1', taskId, { status }, ceo);

    const feature = store.artifactsOf().get(featureId)!;
    expect(feature.status).toBe('done');
    expect(feature.history.at(-1)).toMatchObject({
      actor: { kind: 'system' },
      summary: 'Done: every task is done or cancelled',
      changes: [{ field: 'status', from: 'in_progress', to: 'done' }],
    });
    expect(published).toEqual([
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get(taskId) },
      { kind: 'saved', conversationId: 'c1', artifact: feature },
    ]);
  });

  it('should not finish a feature whose tasks are all cancelled', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-13', { status: 'cancelled' }, ceo);

    expect(statusOf(store, 'F-6')).toBe('in_progress');
  });

  it('should leave a feature without tasks alone', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'F-11', { title: 'Renamed' }, ceo);

    expect(statusOf(store, 'F-11')).toBe('ready');
  });

  it.each([
    ['blocked', 'T-17', 'F-8'],
    ['frozen', 'T-18', 'F-9'],
    ['cancelled', 'T-19', 'F-10'],
  ])('should leave a %s feature alone when its task starts', async (status, taskId, featureId) => {
    const { useCase, store, published } = setupBoard();

    await useCase.execute('c1', taskId, { status: 'in_progress' }, ceo);

    expect(statusOf(store, featureId)).toBe(status);
    expect(published).toHaveLength(1);
  });

  it('should settle the feature a task leaves and the one it joins', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'T-16', { parentId: 'F-3' }, ceo);

    expect(statusOf(store, 'F-7')).toBe('done');
    expect(statusOf(store, 'F-3')).toBe('ready');
  });

  it('should keep the status a user gives a feature, whatever its tasks', async () => {
    const { useCase, store } = setupBoard();

    await useCase.execute('c1', 'F-7', { status: 'ready' }, ceo);
    await useCase.execute('c1', 'F-5', { status: 'backlog' }, ceo);

    expect(statusOf(store, 'F-7')).toBe('ready');
    expect(statusOf(store, 'F-5')).toBe('backlog');
  });
});
