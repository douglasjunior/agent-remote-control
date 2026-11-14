import { Inject, Injectable } from '@nestjs/common';

import type { Artifact, ArtifactActor, ArtifactChangeEvent, ArtifactRemoval } from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';


/** The artifacts that depended on the removed one lose that dependency, and their history says why. */
@Injectable()
export class DeleteArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  async execute(conversationId: string, id: string, actor: ArtifactActor): Promise<ArtifactRemoval> {
    const outcome = await this.store.transaction(conversationId, (transaction): ArtifactRemoval & { readonly events?: readonly ArtifactChangeEvent[] } => {
      const current = transaction.find(id);
      if (!current) {
        return { ok: false, error: `Unknown artifact "${id}".` };
      }
      const children = transaction.list().filter(artifact => artifact.parentId === id);
      if (children.length > 0) {
        return { ok: false, error: `${id} still has ${children.map(child => child.id).join(', ')} under it: move or delete them first.` };
      }
      if (current.assignee) {
        return { ok: false, error: `${id} is with ${current.assignee.roleName}; wait until it is released.` };
      }
      transaction.remove(id);
      const dependents = transaction.list()
        .filter(artifact => artifact.dependsOn.includes(id))
        .map((artifact): Artifact => ({
          ...artifact,
          dependsOn: artifact.dependsOn.filter(dependency => dependency !== id),
          updatedAt: this.history.now(),
          history: [
            ...artifact.history,
            this.history.event(actor, 'updated', `Dependency on ${id} removed: it was deleted`, {
              changes: [{ field: 'depends_on', from: artifact.dependsOn.join(', '), to: artifact.dependsOn.filter(dependency => dependency !== id).join(', ') || 'none' }],
            }),
          ],
        }));
      dependents.forEach(artifact => transaction.save(artifact));
      return {
        ok: true,
        events: [{ kind: 'deleted', conversationId, id }, ...dependents.map(artifact => ({ kind: 'saved' as const, conversationId, artifact }))],
      };
    });
    if (!outcome.ok) {
      return outcome;
    }
    this.events.publish(outcome.events ?? []);
    return { ok: true };
  }
}
