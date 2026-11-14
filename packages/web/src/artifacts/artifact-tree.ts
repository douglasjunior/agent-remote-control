import { ARTIFACT_TYPES, type ArtifactStatus, type ArtifactSummary, type ArtifactType } from '@agent-remote-control/protocol/artifact';


export type ArtifactNode = {
  readonly artifact: ArtifactSummary;
  readonly children: readonly ArtifactNode[];
};

export type ArtifactFilter = {
  readonly text: string;
  /** `null` keeps every project. */
  readonly project: string | null;
  readonly type: ArtifactType | null;
  readonly hideClosed: boolean;
};

export const EMPTY_FILTER: ArtifactFilter = { text: '', project: null, type: null, hideClosed: false };

export function isClosed(status: ArtifactStatus): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Features before tasks; within a type, in the order they were numbered. */
export function compareArtifacts(a: ArtifactSummary, b: ArtifactSummary): number {
  const byType = ARTIFACT_TYPES.indexOf(a.type) - ARTIFACT_TYPES.indexOf(b.type);
  return byType !== 0 ? byType : sequenceOf(a.id) - sequenceOf(b.id) || a.id.localeCompare(b.id);
}

function sequenceOf(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

export function matchesFilter(artifact: ArtifactSummary, filter: ArtifactFilter): boolean {
  const text = filter.text.trim().toLowerCase();
  return (!text || artifact.id.toLowerCase().includes(text) || artifact.title.toLowerCase().includes(text))
    && (filter.project === null || artifact.projectName === filter.project)
    && (filter.type === null || artifact.type === filter.type)
    && !(filter.hideClosed && isClosed(artifact.status));
}

export type ProjectTree = {
  readonly projectName: string;
  readonly features: readonly ArtifactNode[];
  /** Tasks outside any feature. */
  readonly standalone: readonly ArtifactNode[];
};

/**
 * The hierarchy of the artifacts that match, with the ancestors that lead to them, one tree per project in
 * alphabetical order. An artifact whose parent is unknown is a root.
 */
export function buildTree(artifacts: readonly ArtifactSummary[], filter: ArtifactFilter): readonly ProjectTree[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const children = new Map<string, ArtifactSummary[]>();
  const topLevel: ArtifactSummary[] = [];
  for (const artifact of [...artifacts].sort(compareArtifacts)) {
    if (artifact.parentId && byId.has(artifact.parentId)) {
      children.set(artifact.parentId, [...children.get(artifact.parentId) ?? [], artifact]);
    } else {
      topLevel.push(artifact);
    }
  }
  const build = (artifact: ArtifactSummary): ArtifactNode | null => {
    const kept = (children.get(artifact.id) ?? []).map(build).filter(node => node !== null);
    return kept.length > 0 || matchesFilter(artifact, filter) ? { artifact, children: kept } : null;
  };
  const nodes = topLevel.map(build).filter(node => node !== null);
  const projects = [...new Set(nodes.map(node => node.artifact.projectName))].sort((a, b) => a.localeCompare(b));
  return projects.map((projectName) => {
    const inProject = nodes.filter(node => node.artifact.projectName === projectName);
    return {
      projectName,
      features: inProject.filter(node => node.artifact.type === 'feature'),
      standalone: inProject.filter(node => node.artifact.type === 'task'),
    };
  });
}

/** The dependencies still in the way: not done yet, or unknown here. */
export function pendingDependencies(artifact: ArtifactSummary, byId: Readonly<Record<string, ArtifactSummary>>): string[] {
  return artifact.dependsOn.filter(id => byId[id]?.status !== 'done');
}

/** The artifacts that wait on `id`. */
export function dependentsOf(id: string, artifacts: readonly ArtifactSummary[]): ArtifactSummary[] {
  return artifacts.filter(artifact => artifact.dependsOn.includes(id)).sort(compareArtifacts);
}

export function childrenOf(id: string, artifacts: readonly ArtifactSummary[]): ArtifactSummary[] {
  return artifacts.filter(artifact => artifact.parentId === id).sort(compareArtifacts);
}

/**
 * Where an artifact of `type` may hang: a feature stands at the top, a task goes under a feature. `self` keeps the
 * candidates in its project.
 */
export function parentCandidates(
  type: ArtifactType,
  artifacts: readonly ArtifactSummary[],
  self?: Pick<ArtifactSummary, 'projectName'>,
): ArtifactSummary[] {
  if (type === 'feature') {
    return [];
  }
  return artifacts
    .filter(artifact => artifact.type === 'feature' && (!self || artifact.projectName === self.projectName))
    .sort(compareArtifacts);
}

/**
 * What an artifact may depend on: its open siblings of the same type, meaning the other features, the other tasks of
 * its feature, or the other standalone tasks. `selfId` leaves the artifact itself out.
 */
export function dependencyCandidates(
  type: ArtifactType,
  parentId: string | null,
  artifacts: readonly ArtifactSummary[],
  selfId?: string,
): ArtifactSummary[] {
  return artifacts
    .filter(artifact => artifact.type === type
      && (type === 'feature' || artifact.parentId === parentId)
      && artifact.id !== selfId
      && !isClosed(artifact.status))
    .sort(compareArtifacts);
}

/** How far the tasks of a feature are; cancelled tasks do not count. */
export function taskProgress(id: string, artifacts: readonly ArtifactSummary[]): { readonly done: number; readonly total: number } {
  const tasks = childrenOf(id, artifacts).filter(task => task.status !== 'cancelled');
  return { done: tasks.filter(task => task.status === 'done').length, total: tasks.length };
}
