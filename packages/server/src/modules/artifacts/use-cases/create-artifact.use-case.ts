import { Inject, Injectable } from '@nestjs/common';

import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type {
  Artifact,
  ArtifactActor,
  ArtifactOutcome,
  ArtifactRefinement,
  ArtifactSections,
  CreateArtifactInput,
} from '../models/artifact.model.js';
import { IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';
import { ArtifactRulesService } from '../services/artifact-rules.service.js';


@Injectable()
export class CreateArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    private readonly rules: ArtifactRulesService,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  /**
   * A task that owes no refinement is `ready` at once, the path of a simple task straight to development; anything
   * else starts in the `backlog`. Without a project, a task takes its feature's.
   */
  async execute(conversationId: string, input: CreateArtifactInput, actor: ArtifactActor): Promise<ArtifactOutcome> {
    const folders = await this.workspace.listProjectFolders();
    const outcome = await this.store.transaction(conversationId, (transaction): ArtifactOutcome => {
      const title = input.title.trim();
      const parentId = input.parentId ?? null;
      const projectName = input.projectName?.trim() || (parentId ? transaction.find(parentId)?.projectName : undefined) || '';
      const dependsOn = [...new Set(input.dependsOn ?? [])];
      const error = this.rules.checkTitle(title)
        ?? this.rules.checkParent(transaction, input.type, parentId)
        ?? this.rules.checkProject(projectName, folders)
        ?? this.rules.checkSameProject(transaction, parentId, projectName)
        ?? this.rules.checkDependencies(transaction, { type: input.type, parentId }, dependsOn);
      if (error) {
        return { ok: false, error };
      }

      const refinement: ArtifactRefinement = {
        business: input.refinement?.business ?? 'pending',
        technical: input.refinement?.technical ?? 'pending',
      };
      const owesRefinement = refinement.business === 'pending' || refinement.technical === 'pending';
      const id = transaction.allocateId(input.type);
      const now = this.history.now();
      const artifact: Artifact = {
        id,
        type: input.type,
        title,
        status: input.type === 'task' && !owesRefinement ? 'ready' : 'backlog',
        parentId,
        projectName,
        dependsOn,
        refinement,
        assignee: null,
        branch: null,
        pullRequests: [],
        sections: this.cleanSections(input.sections),
        history: [this.history.event(actor, 'created', `Created ${input.type} "${title}"`)],
        createdAt: now,
        updatedAt: now,
      };
      transaction.save(artifact);
      return { ok: true, artifact };
    });
    if (outcome.ok) {
      this.events.publish([{ kind: 'saved', conversationId, artifact: outcome.artifact }]);
    }
    return outcome;
  }

  private cleanSections(sections: ArtifactSections = {}): ArtifactSections {
    return Object.fromEntries(
      Object.entries(sections)
        .map(([section, content]) => [section, content.trim()])
        .filter(([, content]) => content !== ''),
    );
  }
}
