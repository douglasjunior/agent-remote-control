import { describe, expect, it } from '@rstest/core';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { CreateArtifactUseCase } from './create-artifact.use-case.js';


const user = { kind: 'user', channel: 'web' } as const;

function setup(initial = [buildArtifact({ id: 'F-1', type: 'feature', projectNames: ['shop'] })]) {
  const harness = createArtifactHarness(initial);
  return { ...harness, useCase: new CreateArtifactUseCase(harness.store, harness.workspace, harness.rules, harness.history, harness.events, harness.derivation) };
}

describe('CreateArtifactUseCase', () => {
  it('should create a task that owes refinement in the backlog, taking the only project of its feature, and publish it', async () => {
    const { useCase, store, published } = setup([buildArtifact({ id: 'F-1', type: 'feature', projectNames: ['shop'] }), buildArtifact({ id: 'T-7', parentId: 'F-1' })]);

    const outcome = await useCase.execute('c1', {
      type: 'task',
      title: '  Login API ',
      parentId: 'F-1',
      dependsOn: ['T-7', 'T-7'],
      sections: { overview: ' Why ', scope: '   ' },
      refinement: { business: 'done' },
    }, user);

    expect(outcome).toEqual({
      ok: true, artifact: expect.objectContaining({
        id: 'T-1',
        type: 'task',
        title: 'Login API',
        status: 'backlog',
        parentId: 'F-1',
        projectName: 'shop',
        projectNames: ['shop'],
        dependsOn: ['T-7'],
        refinement: { business: 'done', design: 'skipped', technical: 'pending' },
        assignee: null,
        branch: null,
        pullRequests: [],
        sections: { overview: 'Why' },
        history: [expect.objectContaining({ kind: 'created', actor: user, summary: 'Created task "Login API"' })],
      }),
    });
    expect(store.artifactsOf().get('T-1')).toEqual(outcome.ok && outcome.artifact);
    expect(published).toEqual([{ kind: 'saved', conversationId: 'c1', artifact: outcome.ok && outcome.artifact }]);
  });

  it('should make a task that owes no refinement ready for development', async () => {
    const { useCase } = setup();

    const outcome = await useCase.execute('c1', { type: 'task', title: 'Fix typo', projectName: 'web', refinement: { business: 'skipped', design: 'skipped', technical: 'done' } }, user);

    expect(outcome).toMatchObject({ ok: true, artifact: { status: 'ready', projectName: 'web', parentId: null, sections: {} } });
  });

  it('should keep a feature in the backlog with the projects it links, without a project of its own', async () => {
    const { useCase } = setup();

    const feature = await useCase.execute('c1', { type: 'feature', title: 'Checkout', projectNames: [' web ', 'shop', 'web'], refinement: { business: 'skipped', design: 'skipped', technical: 'skipped' } }, user);

    expect(feature).toMatchObject({ ok: true, artifact: { id: 'F-2', type: 'feature', status: 'backlog', projectName: null, projectNames: ['web', 'shop'] } });
  });

  it('should take the single project given as projectName for a feature that lists none', async () => {
    const { useCase } = setup();

    const feature = await useCase.execute('c1', { type: 'feature', title: 'Checkout', projectName: ' web ' }, user);

    expect(feature).toMatchObject({ ok: true, artifact: { projectName: null, projectNames: ['web'] } });
  });

  it('should take the only project of its feature for a task that names none, or a blank one', async () => {
    const { useCase } = setup();

    const task = await useCase.execute('c1', { type: 'task', title: 'Cart', parentId: 'F-1', projectName: '  ' }, user);
    const unnamed = await useCase.execute('c1', { type: 'task', title: 'Cart 2', parentId: 'F-1' }, user);

    expect(task).toMatchObject({ ok: true, artifact: { projectName: 'shop', projectNames: ['shop'] } });
    expect(unnamed).toMatchObject({ ok: true, artifact: { projectName: 'shop', projectNames: ['shop'] } });
  });

  it('should create the tasks of a feature with several projects in one of them', async () => {
    const { useCase } = setup([buildArtifact({ id: 'F-1', type: 'feature', projectNames: ['shop', 'web'] })]);

    expect(await useCase.execute('c1', { type: 'task', title: 'Screen', parentId: 'F-1', projectName: 'web' }, user)).toMatchObject({ ok: true, artifact: { projectName: 'web', projectNames: ['web'] } });
    expect(await useCase.execute('c1', { type: 'task', title: 'Cart', parentId: 'F-1' }, user)).toEqual({ ok: false, error: 'F-1 links the projects "shop", "web": name the one this task works in.' });
  });

  it('should refuse a task in a project its feature does not link', async () => {
    const { useCase } = setup();

    expect(await useCase.execute('c1', { type: 'task', title: 'Screen', parentId: 'F-1', projectName: 'web' }, user))
      .toEqual({ ok: false, error: '"web" is not one of the projects of F-1 ("shop"): a task works in one of them. Add the project to F-1 first.' });
  });

  it.each([
    [{ type: 'task', title: ' ', projectName: 'shop' }, 'An artifact needs a title.'],
    [{ type: 'feature', title: 'Nested', parentId: 'F-1' }, 'A feature is always at the top of the board, so it takes no parent.'],
    [{ type: 'task', title: 'T' }, 'A project is a folder of the workspace root: name it.'],
    [{ type: 'feature', title: 'F' }, 'A feature links at least one project: name its project folders.'],
    [{ type: 'feature', title: 'F', projectNames: ['shop', 'api'] }, 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
    [{ type: 'task', title: 'T', projectNames: ['shop'] }, 'A task works in one project: give its project, not a list of projects.'],
    [{ type: 'task', title: 'T', projectName: 'api' }, 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
    [{ type: 'task', title: 'Docs', parentId: 'X-1' }, 'Unknown parent artifact "X-1".'],
    [{ type: 'task', title: 'T', projectName: 'shop', dependsOn: ['T-9'] }, 'Unknown dependency "T-9".'],
  ] as const)('should refuse an invalid artifact %#', async (input, error) => {
    const { useCase, published, store } = setup();

    expect(await useCase.execute('c1', input, user)).toEqual({ ok: false, error });
    expect(published).toEqual([]);
    expect(store.artifactsOf().size).toBe(1);
  });

  it('should reopen a done feature when a task is created under it, recording why', async () => {
    const { useCase, store, published } = setup([
      buildArtifact({ id: 'F-1', type: 'feature', status: 'done', projectNames: ['shop'] }),
      buildArtifact({ id: 'T-1', parentId: 'F-1', status: 'done' }),
    ]);

    const outcome = await useCase.execute('c1', { type: 'task', title: 'Follow-up', parentId: 'F-1' }, user);

    expect(outcome).toMatchObject({ ok: true, artifact: { id: 'T-2', status: 'backlog' } });
    expect(store.artifactsOf().get('F-1')).toMatchObject({
      status: 'in_progress',
      history: [{ kind: 'updated', actor: { kind: 'system' }, summary: 'In progress: work on its tasks is under way', changes: [{ field: 'status', from: 'done', to: 'in_progress' }] }],
    });
    expect(published).toEqual([
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('T-2') },
      { kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('F-1') },
    ]);
  });

  it('should leave the feature of a new task alone when nothing follows from it', async () => {
    const { useCase, store } = setup();

    await useCase.execute('c1', { type: 'task', title: 'Cart', parentId: 'F-1', refinement: { business: 'done', design: 'skipped', technical: 'done' } }, user);

    expect(store.artifactsOf().get('F-1')?.status).toBe('ready');
  });
});
