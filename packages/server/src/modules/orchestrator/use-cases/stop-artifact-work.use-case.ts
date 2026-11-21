import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { WORK_ENDING_STATUSES } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactChangeEvent } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { buildStoppedWorkPrompt } from '../prompts/stopped-work.prompt.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';


/**
 * A user who moves an artifact an agent is working on to a status that ends the work (done, blocked, cancelled)
 * stops that agent: its work would be thrown away. The CEO receives the stop as the agent's result and goes on.
 */
@Injectable()
export class StopArtifactWorkUseCase implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StopArtifactWorkUseCase.name);
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    private readonly conversationRuntime: ConversationRuntimeService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.artifacts.onChange(event => void this.onChange(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** Reacts only to the change that just happened, so a later save of the same artifact never stops it again. */
  async execute(conversationId: string, artifact: Artifact): Promise<boolean> {
    const holder = artifact.assignee;
    const last = artifact.history.at(-1);
    const change = last?.changes?.find(item => item.field === 'status');
    if (!holder || last?.actor.kind !== 'user' || !change?.to || !WORK_ENDING_STATUSES.includes(change.to)) {
      return false;
    }
    const delegation = this.conversationRuntime.getActiveDelegations(conversationId)
      .find(active => active.delegationId === holder.delegationId);
    if (!delegation) {
      return false;
    }
    this.logger.log(`[Artifact Work Stopped] Conversation=${conversationId}, Artifact=${artifact.id}, Role=${holder.role}, Status=${change.to}`);
    await delegation.stop(buildStoppedWorkPrompt(artifact.id, change.to, artifact.projectNames));
    return true;
  }

  private async onChange(event: ArtifactChangeEvent): Promise<void> {
    if (event.kind !== 'saved') {
      return;
    }
    try {
      await this.execute(event.conversationId, event.artifact);
    } catch (error) {
      this.logger.error(`[Artifact Work Stop Failed] ${event.artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
