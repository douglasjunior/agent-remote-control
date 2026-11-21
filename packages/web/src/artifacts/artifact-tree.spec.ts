import { summary } from '../test/artifact-fixtures.js';

import {
  buildTree, childrenOf, dependencyCandidates, compareArtifacts, dependentsOf, EMPTY_FILTER, isClosed, matchesFilter, parentCandidates, pendingDependencies, stopsWork, taskProgress,
} from './artifact-tree.js';


const feature = summary({ id: 'F-1', type: 'feature', title: 'Login' });
const otherFeature = summary({ id: 'F-2', type: 'feature', title: 'Landing', projectName: 'site' });
const task = summary({ id: 'T-2', title: 'Form', parentId: 'F-1', status: 'done' });
const task10 = summary({ id: 'T-10', title: 'API', parentId: 'F-1', dependsOn: ['T-2', 'T-9'] });
const standalone = summary({ id: 'T-3', title: 'Typo', projectName: 'site' });
const all = [task10, standalone, task, otherFeature, feature];
const byId = Object.fromEntries(all.map(artifact => [artifact.id, artifact]));

describe('artifact-tree', () => {
  it('should order features before tasks, each by its number', () => {
    expect([...all].sort(compareArtifacts).map(artifact => artifact.id)).toEqual(['F-1', 'F-2', 'T-2', 'T-3', 'T-10']);
    expect(compareArtifacts(summary({ id: 'T-x' }), summary({ id: 'T-y' }))).toBeLessThan(0);
  });

  it('should tell closed statuses apart', () => {
    expect(isClosed('done')).toBe(true);
    expect(isClosed('cancelled')).toBe(true);
    expect(isClosed('blocked')).toBe(false);
  });

  it.each([
    [{ text: 'LOG' }, true],
    [{ text: 'f-1' }, true],
    [{ text: 'nope' }, false],
    [{ project: 'site' }, false],
    [{ project: 'app' }, true],
    [{ project: 'site', type: 'feature' as const }, false],
    [{ type: 'task' as const }, false],
    [{ hideClosed: true }, true],
  ])('should filter by %o', (filter, expected) => {
    expect(matchesFilter(feature, { ...EMPTY_FILTER, ...filter })).toBe(expected);
  });

  it('should hide closed artifacts on request', () => {
    expect(matchesFilter(task, { ...EMPTY_FILTER, hideClosed: true })).toBe(false);
  });

  it('should build one tree per project, features first and standalone tasks apart', () => {
    const [app, site] = buildTree(all, EMPTY_FILTER);
    expect(app.projectName).toBe('app');
    expect(app.features.map(node => node.artifact.id)).toEqual(['F-1']);
    expect(app.features[0].children.map(node => node.artifact.id)).toEqual(['T-2', 'T-10']);
    expect(app.standalone).toEqual([]);
    expect(site.features.map(node => node.artifact.id)).toEqual(['F-2']);
    expect(site.standalone.map(node => node.artifact.id)).toEqual(['T-3']);
  });

  it('should keep the feature of a matching task and treat an unknown parent as none', () => {
    const orphan = summary({ id: 'T-4', title: 'Orphan', parentId: 'F-404' });
    const [app] = buildTree([...all, orphan], { ...EMPTY_FILTER, text: 'api' });
    expect(app.features[0].children.map(node => node.artifact.id)).toEqual(['T-10']);
    expect(buildTree([orphan], EMPTY_FILTER)[0].standalone[0].artifact.id).toBe('T-4');
  });

  it('should list the dependencies not done yet, unknown ones included', () => {
    expect(pendingDependencies(task10, byId)).toEqual(['T-9']);
  });

  it('should find dependents and children', () => {
    expect(dependentsOf('T-2', all).map(artifact => artifact.id)).toEqual(['T-10']);
    expect(childrenOf('F-1', all).map(artifact => artifact.id)).toEqual(['T-2', 'T-10']);
  });

  it('should offer features as the parents of a task, in its project when given', () => {
    expect(parentCandidates('feature', all)).toEqual([]);
    expect(parentCandidates('task', all).map(artifact => artifact.id)).toEqual(['F-1', 'F-2']);
    expect(parentCandidates('task', all, { projectNames: ['site'] }).map(artifact => artifact.id)).toEqual(['F-2']);
  });

  it('should treat a feature linking several projects as part of each of them, under the first in the tree', () => {
    const shared = summary({ id: 'F-3', type: 'feature', title: 'Shared', projectNames: ['site', 'app'] });

    expect(matchesFilter(shared, { ...EMPTY_FILTER, project: 'app' })).toBe(true);
    expect(matchesFilter(shared, { ...EMPTY_FILTER, project: 'site' })).toBe(true);
    expect(matchesFilter(shared, { ...EMPTY_FILTER, project: 'docs' })).toBe(false);
    expect(buildTree([shared], EMPTY_FILTER).map(tree => [tree.projectName, tree.features.map(node => node.artifact.id)])).toEqual([['site', ['F-3']]]);
    expect(parentCandidates('task', [...all, shared], { projectNames: ['app'] }).map(artifact => artifact.id)).toEqual(['F-1', 'F-3']);
  });

  it('should offer the open siblings of the same type as dependencies', () => {
    const sibling = summary({ id: 'T-12', parentId: 'F-1' });
    const looseSibling = summary({ id: 'T-13' });
    const artifacts = [...all, sibling, looseSibling];
    expect(dependencyCandidates('task', 'F-1', artifacts, 'T-10').map(artifact => artifact.id)).toEqual(['T-12']);
    expect(dependencyCandidates('task', null, artifacts).map(artifact => artifact.id)).toEqual(['T-3', 'T-13']);
    expect(dependencyCandidates('feature', null, artifacts, 'F-1').map(artifact => artifact.id)).toEqual(['F-2']);
  });

  it('should count the tasks of a feature, leaving cancelled ones out', () => {
    const cancelled = summary({ id: 'T-11', parentId: 'F-1', status: 'cancelled' });
    expect(taskProgress('F-1', [...all, cancelled])).toEqual({ done: 1, total: 2 });
    expect(taskProgress('T-3', all)).toEqual({ done: 0, total: 0 });
  });

  it('should stop the work only of a held artifact moved to a status that ends it', () => {
    const held = summary({ id: 'T-12', status: 'in_progress', assignee: { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd-1', since: '2026-01-01T00:00:00.000Z' } });
    expect(stopsWork(held, 'cancelled')).toBe(true);
    expect(stopsWork(held, 'blocked')).toBe(true);
    expect(stopsWork(held, 'done')).toBe(true);
    expect(stopsWork(held, 'in_review')).toBe(false);
    expect(stopsWork(standalone, 'cancelled')).toBe(false);
  });
});
