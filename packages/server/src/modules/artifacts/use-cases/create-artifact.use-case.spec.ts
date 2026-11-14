import { describe, expect, it } from 'vitest';

import { createArtifactHarness } from '../testing/artifact-harness.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { CreateArtifactUseCase } from './create-artifact.use-case.js';


const user = { kind: 'user', channel: 'web' } as const;

function setup(initial = [buildArtifact({ id: 'F-1', type: 'feature', projectName: 'shop' })]) {
  const harness = createArtifactHarness(initial);
  return { ...harness, useCase: new CreateArtifactUseCase(harness.store, harness.workspace, harness.rules, harness.history, harness.events) };
}

describe('CreateArtifactUseCase', () => {
  it('creates a task that owes refinement in the backlog, taking the parent project, and publishes it', async () => {
    const { useCase, store, published } = setup([buildArtifact({ id: 'F-1', type: 'feature', projectName: 'shop' }), buildArtifact({ id: 'T-7', parentId: 'F-1' })]);

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
        dependsOn: ['T-7'],
        refinement: { business: 'done', technical: 'pending' },
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

  it('makes a task that owes no refinement ready for development', async () => {
    const { useCase } = setup();

    const outcome = await useCase.execute('c1', { type: 'task', title: 'Fix typo', projectName: 'web', refinement: { business: 'skipped', technical: 'done' } }, user);

    expect(outcome).toMatchObject({ ok: true, artifact: { status: 'ready', projectName: 'web', parentId: null, sections: {} } });
  });

  it('keeps features in the backlog, takes an explicit project and treats a blank one as the parent\'s', async () => {
    const { useCase } = setup();

    const feature = await useCase.execute('c1', { type: 'feature', title: 'Checkout', projectName: ' web ', refinement: { business: 'skipped', technical: 'skipped' } }, user);
    const task = await useCase.execute('c1', { type: 'task', title: 'Cart', parentId: 'F-1', projectName: '  ' }, user);

    expect(feature).toMatchObject({ ok: true, artifact: { id: 'F-2', status: 'backlog', projectName: 'web' } });
    expect(task).toMatchObject({ ok: true, artifact: { projectName: 'shop' } });
    expect(await useCase.execute('c1', { type: 'task', title: 'Screen', parentId: 'F-1', projectName: 'web' }, user)).toEqual({ ok: false, error: 'F-1 belongs to project "shop", so its tasks belong there too, not to "web". Work in another project goes in a feature of that project.' });
  });

  it.each([
    [{ type: 'task', title: ' ', projectName: 'shop' }, 'An artifact needs a title.'],
    [{ type: 'feature', title: 'Nested', parentId: 'F-1' }, 'A feature is always at the top of the board, so it takes no parent.'],
    [{ type: 'task', title: 'T' }, 'An artifact belongs to a project: name its project folder.'],
    [{ type: 'task', title: 'T', projectName: 'api' }, 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
    [{ type: 'task', title: 'Docs', parentId: 'X-1' }, 'Unknown parent artifact "X-1".'],
    [{ type: 'task', title: 'T', projectName: 'shop', dependsOn: ['T-9'] }, 'Unknown dependency "T-9".'],
  ] as const)('refuses an invalid artifact %#', async (input, error) => {
    const { useCase, published, store } = setup();

    expect(await useCase.execute('c1', input, user)).toEqual({ ok: false, error });
    expect(published).toEqual([]);
    expect(store.artifactsOf().size).toBe(1);
  });
});
