import { Inject, Injectable } from '@nestjs/common';

import type { Artifact } from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';


/** Only the delegation holding the artifact releases it, so a replaced agent closing late never frees its successor's work. */
@Injectable()
export class ReleaseArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  async execute(conversationId: string, id: string, delegationId: string, outcome: string): Promise<void> {
    const released = await this.store.transaction(conversationId, (transaction): Artifact | undefined => {
      const current = transaction.find(id);
      if (!current?.assignee || current.assignee.delegationId !== delegationId) {
        return undefined;
      }
      const { role, roleName } = current.assignee;
      const artifact = {
        ...current,
        assignee: null,
        updatedAt: this.history.now(),
        history: [
          ...current.history,
          this.history.event({ kind: 'agent', role, roleName }, 'released', `${roleName} released it: ${outcome}`),
        ],
      };
      transaction.save(artifact);
      return artifact;
    });
    if (released) {
      this.events.publish([{ kind: 'saved', conversationId, artifact: released }]);
    }
  }
}
