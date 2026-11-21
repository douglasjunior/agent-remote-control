import { Inject, Injectable } from '@nestjs/common';

import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DEFAULT_REFINEMENT_STATES, REFINEMENT_KINDS } from '../constants/artifact-catalog.constant.js';
import type {
  Artifact,
  ArtifactActor,
  ArtifactOutcome,
  ArtifactRefinement,
  ArtifactSections,
  CreateArtifactInput,
} from '../models/artifact.model.js';
import { type ArtifactTransaction, IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactDerivationService } from '../services/artifact-derivation.service.js';
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
    private readonly derivation: ArtifactDerivationService,
  ) {}

  /**
   * A task that owes no refinement is `ready` at once, the path of a simple task straight to development; anything
   * else starts in the `backlog`. A task works in one project, one of its feature's when it has one; without a project
   * it takes its feature's only one. A task under a feature settles the status its feature derives from its tasks.
   */
  async execute(conversationId: string, input: CreateArtifactInput, actor: ArtifactActor): Promise<ArtifactOutcome> {
    const folders = await this.workspace.listProjectFolders();
    const outcome = await this.store.transaction(conversationId, (transaction): ArtifactOutcome & { readonly derived?: readonly Artifact[] } => {
      const title = input.title.trim();
      const parentId = input.parentId ?? null;
      const dependsOn = [...new Set(input.dependsOn ?? [])];
      const projectNames = this.projectNames(transaction, input, parentId);
      const error = this.rules.checkTitle(title)
        ?? this.rules.checkParent(transaction, input.type, parentId)
        ?? this.checkProjects(transaction, input, parentId, projectNames, folders)
        ?? this.rules.checkDependencies(transaction, { type: input.type, parentId }, dependsOn);
      if (error) {
        return { ok: false, error };
      }

      const refinement = Object.fromEntries(
        REFINEMENT_KINDS.map(kind => [kind, input.refinement?.[kind] ?? DEFAULT_REFINEMENT_STATES[kind]]),
      ) as ArtifactRefinement;
      const id = transaction.allocateId(input.type);
      const now = this.history.now();
      const artifact: Artifact = {
        id,
        type: input.type,
        title,
        status: input.type === 'task' && !this.rules.owesRefinement(refinement) ? 'ready' : 'backlog',
        parentId,
        projectName: input.type === 'task' ? projectNames[0]! : null,
        projectNames,
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
      return { ok: true, artifact, derived: this.derivation.settleTask(transaction, artifact).derived };
    });
    if (!outcome.ok) {
      return outcome;
    }
    this.events.publish([outcome.artifact, ...(outcome.derived ?? [])].map(artifact => ({ kind: 'saved', conversationId, artifact })));
    return { ok: true, artifact: outcome.artifact };
  }

  /** The projects the artifact is created with: a task's own, or its feature's only one when it names none; the list of a feature. */
  private projectNames(transaction: ArtifactTransaction, input: CreateArtifactInput, parentId: string | null): readonly string[] {
    if (input.type === 'task') {
      return [input.projectName?.trim() || this.rules.defaultTaskProject(transaction, parentId) || ''];
    }
    const requested = input.projectNames ?? (input.projectName ? [input.projectName] : []);
    return [...new Set(requested.map(name => name.trim()).filter(Boolean))];
  }

  private checkProjects(
    transaction: ArtifactTransaction,
    input: CreateArtifactInput,
    parentId: string | null,
    projectNames: readonly string[],
    folders: readonly string[],
  ): string | undefined {
    if (input.type === 'feature') {
      return this.rules.checkProjects(projectNames, folders);
    }
    return input.projectNames === undefined
      ? this.rules.checkTaskProject(transaction, parentId, projectNames[0]!, folders)
      : 'A task works in one project: give its project, not a list of projects.';
  }

  private cleanSections(sections: ArtifactSections = {}): ArtifactSections {
    return Object.fromEntries(
      Object.entries(sections)
        .map(([section, content]) => [section, content.trim()])
        .filter(([, content]) => content !== ''),
    );
  }
}
