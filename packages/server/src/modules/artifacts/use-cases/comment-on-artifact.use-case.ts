import { Inject, Injectable } from '@nestjs/common';

import type { ArtifactActor, ArtifactOutcome } from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';


@Injectable()
export class CommentOnArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  async execute(conversationId: string, id: string, text: string, actor: ArtifactActor): Promise<ArtifactOutcome> {
    const comment = text.trim();
    if (!comment) {
      return { ok: false, error: 'A comment needs text.' };
    }
    const outcome = await this.store.transaction(conversationId, (transaction): ArtifactOutcome => {
      const current = transaction.find(id);
      if (!current) {
        return { ok: false, error: `Unknown artifact "${id}".` };
      }
      const artifact = {
        ...current,
        updatedAt: this.history.now(),
        history: [...current.history, this.history.event(actor, 'commented', 'Commented', { text: comment })],
      };
      transaction.save(artifact);
      return { ok: true, artifact };
    });
    if (outcome.ok) {
      this.events.publish([{ kind: 'saved', conversationId, artifact: outcome.artifact }]);
    }
    return outcome;
  }
}
