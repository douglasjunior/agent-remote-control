import { Inject, Injectable } from '@nestjs/common';

import { CLOSED_ARTIFACT_STATUSES } from '../constants/artifact-catalog.constant.js';
import type {
  Artifact,
  ArtifactActor,
  ArtifactAssignee,
  ArtifactChangeEvent,
  ArtifactChanges,
  ArtifactFilter,
  ArtifactOutcome,
  ArtifactRemoval,
  CreateArtifactInput,
} from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import type { IArtifactsPort } from '../ports/artifacts.port.js';
import { AssignArtifactUseCase } from '../use-cases/assign-artifact.use-case.js';
import { CommentOnArtifactUseCase } from '../use-cases/comment-on-artifact.use-case.js';
import { CreateArtifactUseCase } from '../use-cases/create-artifact.use-case.js';
import { DeleteArtifactUseCase } from '../use-cases/delete-artifact.use-case.js';
import { ReleaseArtifactUseCase } from '../use-cases/release-artifact.use-case.js';
import { UpdateArtifactUseCase } from '../use-cases/update-artifact.use-case.js';

import { ArtifactEventsService } from './artifact-events.service.js';


@Injectable()
export class ArtifactsService implements IArtifactsPort {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    private readonly createArtifact: CreateArtifactUseCase,
    private readonly updateArtifact: UpdateArtifactUseCase,
    private readonly commentOnArtifact: CommentOnArtifactUseCase,
    private readonly deleteArtifact: DeleteArtifactUseCase,
    private readonly assignArtifact: AssignArtifactUseCase,
    private readonly releaseArtifact: ReleaseArtifactUseCase,
    private readonly events: ArtifactEventsService,
  ) {}

  /** In creation order, which follows the ids of each type. */
  async list(conversationId: string, filter: ArtifactFilter = {}): Promise<readonly Artifact[]> {
    const { types, statuses, parentId, projectName } = filter;
    return (await this.store.list(conversationId))
      .filter(artifact => !types || types.includes(artifact.type))
      .filter(artifact => statuses === 'all' || (statuses ? statuses.includes(artifact.status) : !CLOSED_ARTIFACT_STATUSES.includes(artifact.status)))
      .filter(artifact => parentId === undefined || artifact.parentId === parentId)
      .filter(artifact => projectName === undefined || artifact.projectName === projectName)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(conversationId: string, id: string): Promise<Artifact | undefined> {
    return this.store.find(conversationId, id);
  }

  create(conversationId: string, input: CreateArtifactInput, actor: ArtifactActor): Promise<ArtifactOutcome> {
    return this.createArtifact.execute(conversationId, input, actor);
  }

  async update(conversationId: string, id: string, changes: ArtifactChanges, actor: ArtifactActor): Promise<ArtifactOutcome> {
    const outcome = await this.updateArtifact.execute(conversationId, id, changes, actor);
    return outcome.ok ? { ok: true, artifact: outcome.artifact } : outcome;
  }

  comment(conversationId: string, id: string, text: string, actor: ArtifactActor): Promise<ArtifactOutcome> {
    return this.commentOnArtifact.execute(conversationId, id, text, actor);
  }

  remove(conversationId: string, id: string, actor: ArtifactActor): Promise<ArtifactRemoval> {
    return this.deleteArtifact.execute(conversationId, id, actor);
  }

  assign(conversationId: string, id: string, assignee: Omit<ArtifactAssignee, 'since'>): Promise<ArtifactOutcome> {
    return this.assignArtifact.execute(conversationId, id, assignee);
  }

  release(conversationId: string, id: string, delegationId: string, outcome: string): Promise<void> {
    return this.releaseArtifact.execute(conversationId, id, delegationId, outcome);
  }

  onChange(listener: (event: ArtifactChangeEvent) => void): () => void {
    return this.events.subscribe(listener);
  }
}
