import type { Artifact, ArtifactFieldChange, ArtifactHistoryEvent } from '../models/artifact.model.js';


export type StatusChange = {
  readonly event: ArtifactHistoryEvent;
  readonly change: ArtifactFieldChange;
};

/** The change that set the current status, or nothing when the status is the one the artifact was created with. */
export function lastStatusChange(artifact: Artifact): StatusChange | undefined {
  for (let index = artifact.history.length - 1; index >= 0; index--) {
    const event = artifact.history[index]!;
    const change = event.changes?.find(item => item.field === 'status');
    if (change) {
      return { event, change };
    }
  }
  return undefined;
}

/** True when a person, not an agent or the server, set the current status after the agent holding it took it. */
export function statusSetByUserWhileHeld(artifact: Artifact): boolean {
  const last = lastStatusChange(artifact);
  return artifact.assignee !== null
    && last?.event.actor.kind === 'user'
    && last.event.at >= artifact.assignee.since;
}
