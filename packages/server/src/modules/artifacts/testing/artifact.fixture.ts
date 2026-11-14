import type { Artifact } from '../models/artifact.model.js';


export const ARTIFACT_AT = '2026-01-01T00:00:00.000Z';

export function buildArtifact(overrides: Partial<Artifact> & Pick<Artifact, 'id'>): Artifact {
  return {
    type: 'task',
    title: `Artifact ${overrides.id}`,
    status: 'ready',
    parentId: null,
    projectName: 'shop',
    dependsOn: [],
    refinement: { business: 'done', technical: 'done' },
    assignee: null,
    branch: null,
    pullRequests: [],
    sections: {},
    history: [],
    createdAt: ARTIFACT_AT,
    updatedAt: ARTIFACT_AT,
    ...overrides,
  };
}
