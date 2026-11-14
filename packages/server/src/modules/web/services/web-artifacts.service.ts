import type {
  ArtifactCreateInput,
  ArtifactDetail,
  ArtifactSummary,
  ArtifactUpdateInput,
} from '@agent-remote-control/protocol/artifact';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import type { Artifact, ArtifactActor, ArtifactChangeEvent, ArtifactSection } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


type ArtifactResult = Extract<ServerEvent, { type: 'artifact.result' }>;

const WEB_ACTOR: ArtifactActor = { kind: 'user', channel: 'web' };

/**
 * The board of each web conversation, for the browser: reads and changes it as the user, and broadcasts every change
 * to the open connections, whoever made it (the user here, an agent, another channel).
 */
@Injectable()
export class WebArtifactsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebArtifactsService.name);
  private unsubscribe?: () => void;

  constructor(
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.artifacts.onChange(event => void this.broadcast(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** Every artifact, closed ones included: the browser filters what it shows. */
  async list(conversationId: string): Promise<ArtifactSummary[]> {
    return (await this.artifacts.list(conversationId, { statuses: 'all' })).map(artifact => this.toSummary(artifact));
  }

  async detail(conversationId: string, id: string): Promise<ArtifactDetail | undefined> {
    const artifact = await this.artifacts.get(conversationId, id);
    return artifact ? this.toDetail(artifact) : undefined;
  }

  async create(conversationId: string, requestId: string, input: ArtifactCreateInput): Promise<ArtifactResult> {
    const outcome = await this.artifacts.create(conversationId, {
      type: input.type,
      title: input.title,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
      ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
      ...(input.sections ? { sections: input.sections } : {}),
      refinement: {
        business: input.businessRefinement ? 'pending' : 'skipped',
        technical: input.technicalRefinement ? 'pending' : 'skipped',
      },
    }, WEB_ACTOR);
    return this.result(conversationId, requestId, outcome.ok ? { id: outcome.artifact.id } : outcome);
  }

  async update(conversationId: string, requestId: string, id: string, changes: ArtifactUpdateInput): Promise<ArtifactResult> {
    const { sections, ...fields } = changes;
    const outcome = await this.artifacts.update(conversationId, id, {
      ...fields,
      ...(sections
        ? { sections: Object.entries(sections).map(([section, content]) => ({ section: section as ArtifactSection, content: content ?? '', mode: 'replace' as const })) }
        : {}),
    }, WEB_ACTOR);
    return this.result(conversationId, requestId, outcome.ok ? { id } : outcome);
  }

  async comment(conversationId: string, requestId: string, id: string, text: string): Promise<ArtifactResult> {
    const outcome = await this.artifacts.comment(conversationId, id, text, WEB_ACTOR);
    return this.result(conversationId, requestId, outcome.ok ? { id } : outcome);
  }

  async remove(conversationId: string, requestId: string, id: string): Promise<ArtifactResult> {
    const outcome = await this.artifacts.remove(conversationId, id, WEB_ACTOR);
    return this.result(conversationId, requestId, outcome.ok ? { id } : outcome);
  }

  /** Changes on boards of other channels stay out of the browser, which knows only web conversations. */
  private async broadcast(event: ArtifactChangeEvent): Promise<void> {
    try {
      if (!await this.store.exists(event.conversationId)) {
        return;
      }
      this.registry.broadcast(event.kind === 'saved'
        ? { type: 'artifact.updated', conversationId: event.conversationId, artifact: this.toSummary(event.artifact) }
        : { type: 'artifact.deleted', conversationId: event.conversationId, id: event.id });
    } catch (error) {
      this.logger.error(`artifact_broadcast_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private result(conversationId: string, requestId: string, outcome: { readonly id: string } | { readonly error: string }): ArtifactResult {
    return 'id' in outcome
      ? { type: 'artifact.result', conversationId, requestId, ok: true, id: outcome.id }
      : { type: 'artifact.result', conversationId, requestId, ok: false, error: outcome.error };
  }

  private toSummary({ sections: _sections, history: _history, ...summary }: Artifact): ArtifactSummary {
    return {
      ...summary,
      dependsOn: [...summary.dependsOn],
      pullRequests: summary.pullRequests.map(link => ({ ...link })),
    };
  }

  private toDetail(artifact: Artifact): ArtifactDetail {
    return {
      ...this.toSummary(artifact),
      sections: { ...artifact.sections },
      history: artifact.history.map(({ changes, ...event }) => ({ ...event, ...(changes ? { changes: [...changes] } : {}) })),
    };
  }
}
