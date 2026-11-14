import { describe, expect, it } from 'vitest';

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
  return { ...harness, useCase: new UpdateArtifactUseCase(harness.store, harness.workspace, harness.rules, harness.history, harness.events) };
}

describe('UpdateArtifactUseCase', () => {
  it('applies every change, records each field and publishes the artifact', async () => {
    const { useCase, published, store } = setup();

    const outcome = await useCase.execute('c1', 'T-1', {
      title: ' Login API ',
      status: 'in_review',
      parentId: 'F-2',
      projectName: 'web',
      dependsOn: ['T-5'],
      refinement: { business: 'done', technical: 'skipped' },
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
        refinement: { business: 'done', technical: 'skipped' },
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
    expect(event?.summary).toBe('Status ready → in_review; updated title, parent, project, depends on, technical refinement, branch, pull request, overview, test cases, technical solution, glossary');
    expect(event?.changes).toEqual([
      { field: 'title', from: 'Artifact T-1', to: 'Login API' },
      { field: 'status', from: 'ready', to: 'in_review' },
      { field: 'parent', from: 'F-1', to: 'F-2' },
      { field: 'project', from: 'shop', to: 'web' },
      { field: 'depends_on', from: 'T-2', to: 'T-5' },
      { field: 'business_refinement', from: 'done', to: 'done' },
      { field: 'technical_refinement', from: 'done', to: 'skipped' },
      { field: 'branch', from: 'feat/a', to: 'feat/b' },
      { field: 'pull_request', from: 'open', to: `${pr} (merged)` },
      { field: 'pull_request', to: 'https://github.com/o/r/pull/8 (open)' },
      { field: 'section:overview', to: 'appended' },
      { field: 'section:test_cases', to: 'cleared' },
      { field: 'section:technical_solution', to: 'replaced' },
      { field: 'section:glossary', to: 'replaced' },
    ].filter(change => change.field !== 'business_refinement'));
    expect(published).toEqual([{ kind: 'saved', conversationId: 'c1', artifact: store.artifactsOf().get('T-1') }]);
  });

  it('summarizes a change without status by its fields', async () => {
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

  it('reads a status change alone as the summary', async () => {
    const { useCase, store } = setup();

    await useCase.execute('c1', 'T-3', { status: 'done', branch: '  ', parentId: null }, ceo);

    expect(store.artifactsOf().get('T-3')!.history.at(-1)?.summary).toBe('Status ready → done');
  });

  it.each<[string, ArtifactChanges]>([
    ['the same values', { title: 'Artifact T-1', status: 'ready', parentId: 'F-1', projectName: 'shop', dependsOn: ['T-2'], branch: 'feat/a', refinement: { business: 'done' } }],
    ['sections that end up the same', { sections: [{ section: 'overview', content: 'Why', mode: 'replace' }, { section: 'scope', content: ' ', mode: 'append' }] }],
    ['a pull request already recorded', { pullRequests: [{ url: pr, title: 'Login' }] }],
  ])('records nothing for %s', async (_name, changes) => {
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
  ])('refuses %s, changing nothing', async (_name, id, changes, error) => {
    const { useCase, published, store } = setup();
    const before = store.artifactsOf().get('T-1');

    expect(await useCase.execute('c1', id, changes, ceo)).toEqual({ ok: false, error });
    expect(store.artifactsOf().get('T-1')).toBe(before);
    expect(published).toEqual([]);
  });
});
