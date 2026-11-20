import { Injectable } from '@nestjs/common';

import type { Artifact, ArtifactStatus } from '../models/artifact.model.js';
import type { ArtifactTransaction } from '../ports/artifact-store.port.js';

import { ArtifactHistoryService } from './artifact-history.service.js';
import { ArtifactRulesService } from './artifact-rules.service.js';


const SUMMARIES: Partial<Record<ArtifactStatus, string>> = {
  backlog: 'Back to the backlog: a refinement is pending',
  ready: 'Ready: no refinement is pending',
  in_progress: 'In progress: work on its tasks is under way',
  done: 'Done: every task is done or cancelled',
};

/**
 * Applies the status changes the board makes by itself, as `system` history events, inside the transaction of the change
 * that caused them. The callers publish the artifacts returned, which are the saved versions.
 */
@Injectable()
export class ArtifactDerivationService {
  constructor(
    private readonly rules: ArtifactRulesService,
    private readonly history: ArtifactHistoryService,
  ) {}

  /**
   * Settles a task just saved: its own readiness, either way, and the status that follows its tasks, for its feature and for the
   * feature it left. `artifact` is the task as it ends up, `derived` the features that changed.
   */
  settleTask(
    transaction: ArtifactTransaction,
    task: Artifact,
    previousParentId: string | null = null,
  ): { readonly artifact: Artifact; readonly derived: readonly Artifact[] } {
    const artifact = this.apply(transaction, task, this.rules.derivedTaskStatus(task));
    const featureIds = [...new Set([artifact.parentId, previousParentId])];
    return { artifact, derived: featureIds.flatMap(featureId => this.settleFeature(transaction, featureId)) };
  }

  /** The feature as saved with its new status, or nothing when it follows no change. */
  settleFeature(transaction: ArtifactTransaction, featureId: string | null): readonly Artifact[] {
    const feature = featureId ? transaction.find(featureId) : undefined;
    if (!feature) {
      return [];
    }
    const tasks = transaction.list().filter(task => task.parentId === feature.id);
    const settled = this.apply(transaction, feature, this.rules.derivedFeatureStatus(feature, tasks));
    return settled === feature ? [] : [settled];
  }

  private apply(transaction: ArtifactTransaction, artifact: Artifact, status: ArtifactStatus | undefined): Artifact {
    if (!status) {
      return artifact;
    }
    const settled: Artifact = {
      ...artifact,
      status,
      updatedAt: this.history.now(),
      history: [
        ...artifact.history,
        this.history.event({ kind: 'system' }, 'updated', SUMMARIES[status]!, {
          changes: [{ field: 'status', from: artifact.status, to: status }],
        }),
      ],
    };
    transaction.save(settled);
    return settled;
  }
}
