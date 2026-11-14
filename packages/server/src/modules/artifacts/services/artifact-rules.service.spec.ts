import { describe, expect, it } from 'vitest';

import type { ArtifactTransaction } from '../ports/artifact-store.port.js';
import { buildArtifact } from '../testing/artifact.fixture.js';
import { InMemoryArtifactStoreFake } from '../testing/in-memory-artifact-store.fake.js';

import { ArtifactRulesService } from './artifact-rules.service.js';


const rules = new ArtifactRulesService();

async function check<T>(work: (transaction: ArtifactTransaction) => T): Promise<T> {
  const store = new InMemoryArtifactStoreFake([
    buildArtifact({ id: 'F-1', type: 'feature' }),
    buildArtifact({ id: 'F-2', type: 'feature', dependsOn: ['F-1'] }),
    buildArtifact({ id: 'T-1', parentId: 'F-1' }),
    buildArtifact({ id: 'T-4', parentId: 'F-1', dependsOn: ['T-1'] }),
    buildArtifact({ id: 'T-2' }),
    buildArtifact({ id: 'T-3', dependsOn: ['T-2'] }),
  ]);
  return store.transaction('c1', work);
}

describe('ArtifactRulesService', () => {
  it.each([
    ['', 'An artifact needs a title.'],
    ['x'.repeat(201), 'A title has at most 200 characters.'],
    ['Login', undefined],
  ])('checks the title %#', (title, expected) => {
    expect(rules.checkTitle(title)).toBe(expected);
  });

  it.each([
    ['task', null, undefined],
    ['task', 'F-1', undefined],
    ['feature', null, undefined],
    ['feature', 'F-1', 'A feature is always at the top of the board, so it takes no parent.'],
    ['task', 'X-9', 'Unknown parent artifact "X-9".'],
    ['task', 'T-1', 'A task goes under a feature, and T-1 is a task.'],
  ] as const)('checks a %s under %s', async (type, parentId, expected) => {
    expect(await check(transaction => rules.checkParent(transaction, type, parentId))).toBe(expected);
  });

  const task = (parentId: string | null, id?: string) => ({ type: 'task' as const, parentId, ...(id ? { id } : {}) });
  const feature = (id?: string) => ({ type: 'feature' as const, parentId: null, ...(id ? { id } : {}) });

  it.each([
    ['a new task on tasks of its feature', task('F-1'), ['T-1', 'T-4'], undefined],
    ['a new standalone task on a standalone task', task(null), ['T-3'], undefined],
    ['a new feature on features', feature(), ['F-1', 'F-2'], undefined],
    ['an artifact on itself', task('F-1', 'T-1'), ['T-1'], 'T-1 cannot depend on itself.'],
    ['an unknown dependency', task('F-1', 'T-1'), ['X-1'], 'Unknown dependency "X-1".'],
    ['a task cycle', task('F-1', 'T-1'), ['T-4'], 'T-1 cannot depend on T-4, because T-4 already depends on T-1.'],
    ['a feature cycle', feature('F-1'), ['F-2'], 'F-1 cannot depend on F-2, because F-2 already depends on F-1.'],
    ['a task on a task of no feature', task('F-1'), ['T-2'], 'T-2 cannot be a dependency here: a task depends only on other tasks of its feature, F-1.'],
    ['a standalone task on a task of a feature', task(null), ['T-1'], 'T-1 cannot be a dependency here: a standalone task depends only on other standalone tasks.'],
    ['a feature on a task', feature(), ['T-2'], 'T-2 cannot be a dependency here: a feature depends only on other features.'],
    ['a task on a feature', task('F-1'), ['F-2'], 'F-2 cannot be a dependency here: a task depends only on other tasks of its feature, F-1.'],
  ] as const)('checks %s', async (_name, place, dependsOn, expected) => {
    expect(await check(transaction => rules.checkDependencies(transaction, place, dependsOn))).toBe(expected);
  });

  it('follows shared dependencies once', async () => {
    const store = new InMemoryArtifactStoreFake([
      buildArtifact({ id: 'T-1' }),
      buildArtifact({ id: 'T-2', dependsOn: ['T-1'] }),
      buildArtifact({ id: 'T-3', dependsOn: ['T-1'] }),
      buildArtifact({ id: 'T-4', dependsOn: ['T-2', 'T-3', 'T-1'] }),
    ]);

    expect(await store.transaction('c1', transaction => rules.checkDependencies(transaction, task(null, 'T-5'), ['T-4']))).toBeUndefined();
  });

  it.each([
    ['T-1', 'F-2', 'T-4 depends on T-1, and dependencies stay among siblings: remove that dependency before moving T-1.'],
    ['T-2', 'F-1', 'T-3 depends on T-2, and dependencies stay among siblings: remove that dependency before moving T-2.'],
    ['T-3', 'F-1', undefined],
  ])('checks the siblings that depend on %s moving to %s', async (id, parentId, expected) => {
    expect(await check(transaction => rules.checkDependents(transaction, { id, type: 'task', parentId }))).toBe(expected);
  });

  it('names every sibling left behind', async () => {
    const store = new InMemoryArtifactStoreFake([
      buildArtifact({ id: 'T-1' }),
      buildArtifact({ id: 'T-2', dependsOn: ['T-1'] }),
      buildArtifact({ id: 'T-3', dependsOn: ['T-1'] }),
    ]);

    expect(await store.transaction('c1', transaction => rules.checkDependents(transaction, { id: 'T-1', type: 'task', parentId: 'F-1' }))).toBe(
      'T-2, T-3 depend on T-1, and dependencies stay among siblings: remove those dependencies before moving T-1.',
    );
  });

  it.each([
    ['shop', ['shop', 'web'], undefined],
    ['', ['shop'], 'An artifact belongs to a project: name its project folder.'],
    ['shop/src', ['shop', 'web'], 'Unknown project "shop/src". Use one of the project folders exactly as written: shop, web.'],
    ['shop', [], 'Unknown project "shop": the workspace root has no project folder yet.'],
  ])('checks the project %j among %j', (projectName, folders, expected) => {
    expect(rules.checkProject(projectName, folders)).toBe(expected);
  });

  it.each([
    [null, 'web', undefined],
    ['F-1', 'shop', undefined],
    ['X-1', 'web', undefined],
    ['F-1', 'web', 'F-1 belongs to project "shop", so its tasks belong there too, not to "web". Work in another project goes in a feature of that project.'],
  ])('checks that a task under %s shares the project %s', async (parentId, projectName, expected) => {
    expect(await check(transaction => rules.checkSameProject(transaction, parentId, projectName))).toBe(expected);
  });

  it.each([
    ['https://github.com/o/r/pull/1', undefined],
    ['github.com/o/r/pull/1', '"github.com/o/r/pull/1" is not a pull request URL: use its full http(s) address.'],
  ])('checks the pull request URL %s', (url, expected) => {
    expect(rules.checkPullRequestUrl(url)).toBe(expected);
  });
});
