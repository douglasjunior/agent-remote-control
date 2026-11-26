import type { ArtifactDependencyEntity } from '../entities/artifact-dependency.entity.js';
import type { ArtifactHistoryChangeEntity } from '../entities/artifact-history-change.entity.js';
import type { ArtifactHistoryEntity } from '../entities/artifact-history.entity.js';
import type { ArtifactProjectEntity } from '../entities/artifact-project.entity.js';
import type { ArtifactPullRequestEntity } from '../entities/artifact-pull-request.entity.js';
import type { ArtifactRefinementEntity } from '../entities/artifact-refinement.entity.js';
import type { ArtifactSectionEntity } from '../entities/artifact-section.entity.js';
import type { ArtifactEntity } from '../entities/artifact.entity.js';
import type { Artifact, ArtifactHistoryEvent } from '../models/artifact.model.js';


export type ArtifactHistoryRows = {
  readonly event: ArtifactHistoryEntity;
  readonly changes: readonly ArtifactHistoryChangeEntity[];
};

/** An artifact as the rows of the board tables. */
export type ArtifactRows = {
  readonly artifact: ArtifactEntity;
  readonly refinements: readonly ArtifactRefinementEntity[];
  readonly sections: readonly ArtifactSectionEntity[];
  readonly dependencies: readonly ArtifactDependencyEntity[];
  readonly projects: readonly ArtifactProjectEntity[];
  readonly pullRequests: readonly ArtifactPullRequestEntity[];
  readonly history: readonly ArtifactHistoryRows[];
};

/**
 * The rows that hold `artifact` at `position` of its conversation's board; an optional field left out is `NULL`. A task
 * keeps its project in the artifact row and a feature in `artifact_project` rows.
 */
export function toArtifactRows(conversationId: string, artifact: Artifact, position: number): ArtifactRows {
  const owner = { conversationId, artifactId: artifact.id };
  return {
    artifact: {
      conversationId,
      id: artifact.id,
      position,
      type: artifact.type,
      title: artifact.title,
      status: artifact.status,
      parentId: artifact.parentId,
      projectName: artifact.projectName,
      assigneeRole: artifact.assignee?.role ?? null,
      assigneeRoleName: artifact.assignee?.roleName ?? null,
      assigneeDelegationId: artifact.assignee?.delegationId ?? null,
      assigneeSince: artifact.assignee?.since ?? null,
      branch: artifact.branch,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    },
    refinements: Object.entries(artifact.refinement).map(([kind, state]) => ({ ...owner, kind, state })),
    sections: Object.entries(artifact.sections).map(([section, content]) => ({ ...owner, section, content })),
    dependencies: artifact.dependsOn.map((dependsOnId, index) => ({ ...owner, position: index, dependsOnId })),
    projects: artifact.type === 'feature'
      ? artifact.projectNames.map((projectName, index) => ({ ...owner, position: index, projectName }))
      : [],
    pullRequests: artifact.pullRequests.map((link, index) => ({
      ...owner,
      position: index,
      url: link.url,
      title: link.title ?? null,
      repository: link.repository,
      state: link.state,
      addedAt: link.addedAt,
    })),
    history: artifact.history.map((event, index) => historyRows(conversationId, artifact.id, event, index)),
  };
}

function historyRows(conversationId: string, artifactId: string, event: ArtifactHistoryEvent, eventPosition: number): ArtifactHistoryRows {
  const { actor } = event;
  return {
    event: {
      conversationId,
      artifactId,
      position: eventPosition,
      eventId: event.id,
      at: event.at,
      actorKind: actor.kind,
      actorRole: actor.kind === 'agent' ? actor.role : null,
      actorRoleName: actor.kind === 'agent' ? actor.roleName : null,
      actorChannel: actor.kind === 'user' ? actor.channel : null,
      kind: event.kind,
      summary: event.summary,
      text: event.text ?? null,
    },
    changes: (event.changes ?? []).map((change, index) => ({
      conversationId,
      artifactId,
      eventPosition,
      position: index,
      field: change.field,
      fromValue: change.from ?? null,
      toValue: change.to ?? null,
    })),
  };
}
