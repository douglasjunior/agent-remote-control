import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { Artifact } from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';


/**
 * No agent survives a restart, so every holder recorded on disk is stale when the server starts. Work the restart
 * interrupted takes its artifact again when the user resumes it.
 */
@Injectable()
export class ReleaseStaleAssignmentsUseCase implements OnModuleInit {
  private readonly logger = new Logger(ReleaseStaleAssignmentsUseCase.name);

  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.execute();
  }

  /** A failure is only logged: a stale holder blocks one artifact, not the server. */
  async execute(): Promise<void> {
    try {
      for (const conversationId of await this.store.conversations()) {
        await this.releaseBoard(conversationId);
      }
    } catch (error) {
      this.logger.error(`[Artifacts Release Failed] ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async releaseBoard(conversationId: string): Promise<void> {
    if (!(await this.store.list(conversationId)).some(artifact => artifact.assignee !== null)) {
      return;
    }
    const released = await this.store.transaction(conversationId, transaction => transaction.list()
      .filter(artifact => artifact.assignee !== null)
      .map((artifact): Artifact => {
        const free = {
          ...artifact,
          assignee: null,
          updatedAt: this.history.now(),
          history: [
            ...artifact.history,
            this.history.event({ kind: 'system' }, 'released', `Released: the server restarted while ${artifact.assignee!.roleName} held it`),
          ],
        };
        transaction.save(free);
        return free;
      }));
    this.logger.log(`[Artifacts Released] Conversation=${conversationId}: ${released.map(artifact => artifact.id).join(', ')}`);
    this.events.publish(released.map(artifact => ({ kind: 'saved', conversationId, artifact })));
  }
}
