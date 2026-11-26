import type { Artifact } from '../models/artifact.model.js';


export const ARTIFACT_AT = '2026-01-01T00:00:00.000Z';

/** A task in the project `shop`; `projectName` sets a task's project and `projectNames` a feature's, whose `projectName` is `null`. */
export function buildArtifact({ projectName, projectNames, ...overrides }: Partial<Artifact> & Pick<Artifact, 'id'>): Artifact {
  const type = overrides.type ?? 'task';
  const projects = projectNames ?? [projectName ?? 'shop'];
  return {
    type,
    title: `Artifact ${overrides.id}`,
    status: 'ready',
    parentId: null,
    dependsOn: [],
    refinement: { business: 'done', design: 'done', technical: 'done' },
    assignee: null,
    branch: null,
    pullRequests: [],
    sections: {},
    history: [],
    createdAt: ARTIFACT_AT,
    updatedAt: ARTIFACT_AT,
    ...overrides,
    projectName: type === 'feature' ? null : projects[0]!,
    projectNames: projects,
  };
}

/** An artifact with every optional field and list filled, and one of each actor in its history. */
export function buildPopulatedArtifact(overrides: Partial<Artifact> & Pick<Artifact, 'id'>): Artifact {
  return buildArtifact({
    status: 'tested',
    parentId: 'F-1',
    dependsOn: ['T-7', 'T-3'],
    refinement: { business: 'skipped', design: 'done', technical: 'pending' },
    assignee: { role: 'QA', roleName: 'QA Engineer', delegationId: 'd-1', since: '2026-01-02T00:00:00.000Z' },
    branch: 'feat/t-1',
    pullRequests: [
      { url: 'https://example.com/pr/1', title: 'First', repository: '.', state: 'merged', addedAt: '2026-01-03T00:00:00.000Z' },
      { url: 'https://example.com/pr/2', repository: 'repositories/api', state: 'open', addedAt: '2026-01-04T00:00:00.000Z' },
    ],
    sections: { overview: 'The **overview**.', test_report: '' },
    history: [
      { id: 'e-1', at: ARTIFACT_AT, actor: { kind: 'agent', role: 'CEO', roleName: 'CEO' }, kind: 'created', summary: 'Created' },
      {
        id: 'e-2',
        at: '2026-01-02T00:00:00.000Z',
        actor: { kind: 'user', channel: 'web' },
        kind: 'updated',
        summary: 'Moved',
        changes: [{ field: 'status', from: 'ready', to: 'tested' }, { field: 'section:overview', to: 'replaced' }, { field: 'branch' }],
        text: 'Because',
      },
      { id: 'e-3', at: '2026-01-03T00:00:00.000Z', actor: { kind: 'system' }, kind: 'released', summary: 'Released' },
    ],
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  });
}
