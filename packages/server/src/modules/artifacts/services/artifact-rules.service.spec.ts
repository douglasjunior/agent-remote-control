import { describe, expect, it } from '@rstest/core';

import type { ArtifactStatus } from '../models/artifact.model.js';
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
    buildArtifact({ id: 'F-3', type: 'feature', projectNames: ['shop', 'web'] }),
    buildArtifact({ id: 'T-5', parentId: 'F-3', projectName: 'shop' }),
    buildArtifact({ id: 'T-6', parentId: 'F-3', projectName: 'web' }),
  ]);
  return store.transaction('c1', work);
}

describe('ArtifactRulesService', () => {
  it.each([
    ['', 'An artifact needs a title.'],
    ['x'.repeat(201), 'A title has at most 200 characters.'],
    ['Login', undefined],
  ])('should check the title %#', (title, expected) => {
    expect(rules.checkTitle(title)).toBe(expected);
  });

  it.each([
    ['task', null, undefined],
    ['task', 'F-1', undefined],
    ['feature', null, undefined],
    ['feature', 'F-1', 'A feature is always at the top of the board, so it takes no parent.'],
    ['task', 'X-9', 'Unknown parent artifact "X-9".'],
    ['task', 'T-1', 'A task goes under a feature, and T-1 is a task.'],
  ] as const)('should check a %s under %s', async (type, parentId, expected) => {
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
  ] as const)('should check %s', async (_name, place, dependsOn, expected) => {
    expect(await check(transaction => rules.checkDependencies(transaction, place, dependsOn))).toBe(expected);
  });

  it('should follow shared dependencies once', async () => {
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
  ])('should check the siblings that depend on %s moving to %s', async (id, parentId, expected) => {
    expect(await check(transaction => rules.checkDependents(transaction, { id, type: 'task', parentId }))).toBe(expected);
  });

  it('should name every sibling left behind', async () => {
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
    ['', ['shop'], 'A project is a folder of the workspace root: name it.'],
    ['shop/src', ['shop', 'web'], 'Unknown project "shop/src". Use one of the project folders exactly as written: shop, web.'],
    ['shop', [], 'Unknown project "shop": the workspace root has no project folder yet.'],
  ])('should check the project %j among %j', (projectName, folders, expected) => {
    expect(rules.checkProject(projectName, folders)).toBe(expected);
  });

  it.each([
    [['shop'], undefined],
    [['shop', 'web'], undefined],
    [[], 'A feature links at least one project: name its project folders.'],
    [['shop', 'api'], 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
  ])('should check the projects %j of a feature', (projectNames, expected) => {
    expect(rules.checkProjects(projectNames, ['shop', 'web'])).toBe(expected);
  });

  it.each([
    ['a feature with one project', 'F-1', 'shop'],
    ['a feature with several projects', 'F-3', undefined],
    ['no feature', null, undefined],
    ['an unknown feature', 'X-1', undefined],
  ])('should default the project of a task of %s', async (_name, parentId, expected) => {
    expect(await check(transaction => rules.defaultTaskProject(transaction, parentId))).toBe(expected);
  });

  it.each([
    ['a standalone task in a project', null, 'web', undefined],
    ['a standalone task without a project', null, '', 'A project is a folder of the workspace root: name it.'],
    ['a task in the only project of its feature', 'F-1', 'shop', undefined],
    ['a task in one of the projects of its feature', 'F-3', 'web', undefined],
    ['a task in another project than the only one of its feature', 'F-1', 'web', '"web" is not one of the projects of F-1 ("shop"): a task works in one of them. Add the project to F-1 first.'],
    ['a task in a project outside its feature\'s', 'F-3', 'docs', 'Unknown project "docs". Use one of the project folders exactly as written: shop, web.'],
    ['a task without a project under a feature with several', 'F-3', '', 'F-3 links the projects "shop", "web": name the one this task works in.'],
    ['a task under an unknown feature', 'X-1', 'web', undefined],
  ])('should check %s', async (_name, parentId, projectName, expected) => {
    expect(await check(transaction => rules.checkTaskProject(transaction, parentId, projectName, ['shop', 'web']))).toBe(expected);
  });

  it.each([
    ['T-1 in a project of F-3', 'F-3', 'shop', undefined],
    ['T-1 in a project outside F-3', 'F-1', 'web', '"web" is not one of the projects of F-1 ("shop"): a task works in one of them. Add the project to F-1 first.'],
    ['a standalone task', null, 'web', undefined],
  ])('should check the project of %s', async (_name, parentId, projectName, expected) => {
    expect(await check(transaction => rules.checkProjectOfFeature(parentId ? transaction.find(parentId) : undefined, projectName))).toBe(expected);
  });

  it.each([
    ['adding a project', 'F-3', ['shop', 'web', 'docs'], ['shop', 'web', 'docs'], undefined],
    ['dropping a project a task works in', 'F-3', ['shop'], ['shop', 'web'], 'F-3 still has tasks in "web" (T-6), so it keeps that project: move the tasks to another project of the feature first.'],
    ['adding a project to a feature without tasks in it', 'F-1', ['shop', 'web'], ['shop', 'web'], undefined],
    ['replacing every project', 'F-3', ['docs'], ['shop', 'web', 'docs'], 'F-3 still has tasks in "shop", "web" (T-5, T-6), so it keeps those projects: move the tasks to another project of the feature first.'],
    ['an empty list', 'F-3', [], ['shop', 'web'], 'A feature links at least one project: name its project folders.'],
    ['an unknown project', 'F-3', ['shop', 'web', 'api'], ['shop', 'web'], 'Unknown project "api". Use one of the project folders exactly as written: shop, web.'],
  ])('should check %s of %s to %j', async (_name, featureId, projectNames, folders, expected) => {
    expect(await check(transaction => rules.checkFeatureProjects(transaction, transaction.find(featureId)!, projectNames, folders))).toBe(expected);
  });

  it.each([
    ['.', undefined],
    ['repositories/klist-webservice', undefined],
    ['/etc', '"/etc" is not a repository path: give it relative to the project folder of the task, "." for the folder itself.'],
    ['C:/repo', '"C:/repo" is not a repository path: give it relative to the project folder of the task, "." for the folder itself.'],
    ['../other', '"../other" is not a repository path: give it relative to the project folder of the task, "." for the folder itself.'],
    ['a/../../b', '"a/../../b" is not a repository path: give it relative to the project folder of the task, "." for the folder itself.'],
  ])('should check the pull request repository %s', (repository, expected) => {
    expect(rules.checkPullRequestRepository(repository)).toBe(expected);
  });

  it.each([
    ['https://github.com/o/r/pull/1', undefined],
    ['github.com/o/r/pull/1', '"github.com/o/r/pull/1" is not a pull request URL: use its full http(s) address.'],
  ])('should check the pull request URL %s', (url, expected) => {
    expect(rules.checkPullRequestUrl(url)).toBe(expected);
  });

  it.each([
    [{ business: 'pending', design: 'skipped', technical: 'done' }, true],
    [{ business: 'skipped', design: 'skipped', technical: 'pending' }, true],
    [{ business: 'done', design: 'pending', technical: 'done' }, true],
    [{ business: 'done', design: 'skipped', technical: 'skipped' }, false],
  ] as const)('should tell whether %j owes a refinement', (refinement, expected) => {
    expect(rules.owesRefinement(refinement)).toBe(expected);
  });

  it.each([
    ['a backlog task owing nothing', { status: 'backlog', refinement: { business: 'done', design: 'skipped', technical: 'skipped' } }, 'ready'],
    ['a backlog task owing the business refinement', { status: 'backlog', refinement: { business: 'pending', design: 'skipped', technical: 'done' } }, undefined],
    ['a backlog task owing the technical refinement', { status: 'backlog', refinement: { business: 'done', design: 'skipped', technical: 'pending' } }, undefined],
    ['a ready task owing the business refinement', { status: 'ready', refinement: { business: 'pending', design: 'skipped', technical: 'done' } }, 'backlog'],
    ['a ready task owing the technical refinement', { status: 'ready', refinement: { business: 'skipped', design: 'skipped', technical: 'pending' } }, 'backlog'],
    ['a ready task owing the design refinement', { status: 'ready', refinement: { business: 'done', design: 'pending', technical: 'done' } }, 'backlog'],
    ['a ready task owing nothing', { status: 'ready', refinement: { business: 'done', design: 'skipped', technical: 'skipped' } }, undefined],
    ['a task in another status', { status: 'blocked', refinement: { business: 'done', design: 'skipped', technical: 'done' } }, undefined],
    ['a parked task owing a refinement', { status: 'blocked', refinement: { business: 'pending', design: 'skipped', technical: 'done' } }, undefined],
    ['a ready feature owing a refinement', { type: 'feature', status: 'ready', refinement: { business: 'pending', design: 'skipped', technical: 'done' } }, undefined],
    ['a backlog feature owing nothing', { type: 'feature', status: 'backlog', refinement: { business: 'done', design: 'skipped', technical: 'done' } }, undefined],
  ] as const)('should derive the status of %s', (_name, overrides, expected) => {
    expect(rules.derivedTaskStatus(buildArtifact({ id: 'T-1', ...overrides }))).toBe(expected);
  });

  const tasksIn = (...statuses: ArtifactStatus[]) => statuses.map((status, index) => buildArtifact({ id: `T-${index + 1}`, parentId: 'F-1', status }));

  it.each<[string, ArtifactStatus, ArtifactStatus[], ArtifactStatus | undefined]>([
    ['a backlog feature once a task is in progress', 'backlog', ['in_progress', 'ready'], 'in_progress'],
    ['a ready feature once a task is in review', 'ready', ['ready', 'in_review'], 'in_progress'],
    ['a ready feature once a task is in testing', 'ready', ['in_testing', 'backlog'], 'in_progress'],
    ['a reopened done feature with a task under way', 'done', ['done', 'changes_requested'], 'in_progress'],
    ['a done feature with a done task and an open one', 'done', ['done', 'ready'], 'in_progress'],
    ['a ready feature whose tasks all wait', 'ready', ['ready', 'backlog', 'cancelled'], undefined],
    ['a feature already in progress with a task under way', 'in_progress', ['approved', 'ready'], undefined],
    ['a feature in progress once every task is closed', 'in_progress', ['done', 'cancelled'], 'done'],
    ['a ready feature once every task is closed', 'ready', ['done', 'done'], 'done'],
    ['a backlog feature once every task is closed', 'backlog', ['cancelled', 'done'], 'done'],
    ['a done feature whose tasks are all closed', 'done', ['done', 'cancelled'], undefined],
    ['a feature whose tasks are all cancelled', 'in_progress', ['cancelled', 'cancelled'], undefined],
    ['a blocked feature', 'blocked', ['done', 'cancelled'], undefined],
    ['a frozen feature', 'frozen', ['in_progress'], undefined],
    ['a cancelled feature', 'cancelled', ['in_progress', 'ready'], undefined],
    ['a feature in review', 'in_review', ['in_progress'], undefined],
  ])('should derive the status of %s', (_name, status, tasks, expected) => {
    expect(rules.derivedFeatureStatus(buildArtifact({ id: 'F-1', type: 'feature', status }), tasksIn(...tasks))).toBe(expected);
  });

  it('should leave a feature without tasks and a task alone', () => {
    expect(rules.derivedFeatureStatus(buildArtifact({ id: 'F-1', type: 'feature', status: 'backlog' }), [])).toBeUndefined();
    expect(rules.derivedFeatureStatus(buildArtifact({ id: 'T-1', status: 'backlog' }), tasksIn('in_progress'))).toBeUndefined();
  });
});
