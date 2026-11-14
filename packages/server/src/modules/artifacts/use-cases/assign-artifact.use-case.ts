import { Inject, Injectable } from '@nestjs/common';

import { FROZEN_STATUS } from '../constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactAssignee, ArtifactOutcome } from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';
import { ArtifactLimitsConfigService } from '../services/artifact-limits-config.service.js';


type AssignOutcome =
  | { readonly ok: true; readonly artifact: Artifact; readonly changed?: boolean }
  | { readonly ok: false; readonly error: string; readonly frozen?: Artifact };

/**
 * An artifact is with one agent at a time: a delegation takes it only when it is free or already its own. An artifact
 * that already went through the maximum of delegations is frozen instead, the guard against agents looping on it.
 */
@Injectable()
export class AssignArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
    private readonly limits: ArtifactLimitsConfigService,
  ) {}

  async execute(conversationId: string, id: string, assignee: Omit<ArtifactAssignee, 'since'>): Promise<ArtifactOutcome> {
    const outcome = await this.store.transaction(conversationId, (transaction): AssignOutcome => {
      const current = transaction.find(id);
      if (!current) {
        return { ok: false, error: `Unknown artifact "${id}".` };
      }
      if (current.assignee?.delegationId === assignee.delegationId) {
        return { ok: true, artifact: current };
      }
      if (current.assignee) {
        return { ok: false, error: `${id} is with ${current.assignee.roleName} (${current.assignee.role}) right now; an artifact is with one agent at a time.` };
      }
      if (current.status === FROZEN_STATUS) {
        return { ok: false, error: this.frozenError(id) };
      }
      const max = this.limits.getMaxDelegations();
      if (max > 0 && this.delegationsSinceUnfrozen(current) >= max) {
        const frozen: Artifact = {
          ...current,
          status: FROZEN_STATUS,
          updatedAt: this.history.now(),
          history: [
            ...current.history,
            this.history.event({ kind: 'system' }, 'updated', `Frozen after ${max} delegations`, {
              changes: [{ field: 'status', from: current.status, to: FROZEN_STATUS }],
            }),
          ],
        };
        transaction.save(frozen);
        return { ok: false, error: this.frozenError(id), frozen };
      }
      const now = this.history.now();
      const artifact = {
        ...current,
        assignee: { ...assignee, since: now },
        updatedAt: now,
        history: [
          ...current.history,
          this.history.event(
            { kind: 'agent', role: assignee.role, roleName: assignee.roleName },
            'assigned',
            `${assignee.roleName} took it`,
          ),
        ],
      };
      transaction.save(artifact);
      return { ok: true, artifact, changed: true };
    });
    if (!outcome.ok) {
      if (outcome.frozen) {
        this.events.publish([{ kind: 'saved', conversationId, artifact: outcome.frozen }]);
      }
      return { ok: false, error: outcome.error };
    }
    if (outcome.changed) {
      this.events.publish([{ kind: 'saved', conversationId, artifact: outcome.artifact }]);
    }
    return { ok: true, artifact: outcome.artifact };
  }

  /** Delegations since the artifact was created or the user last took it out of `frozen`. */
  private delegationsSinceUnfrozen(artifact: Artifact): number {
    const unfrozen = artifact.history.findLastIndex(event => event.changes?.some(change => change.field === 'status' && change.from === FROZEN_STATUS));
    return artifact.history.slice(unfrozen + 1).filter(event => event.kind === 'assigned').length;
  }

  private frozenError(id: string): string {
    return `${id} is frozen: it went through too many delegations without being finished. Only the user takes it out of frozen; tell the user what is going wrong with it.`;
  }
}
