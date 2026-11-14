import { Inject, Injectable } from '@nestjs/common';

import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type {
  Artifact,
  ArtifactActor,
  ArtifactChanges,
  ArtifactFieldChange,
  ArtifactOutcome,
  ArtifactSections,
  PullRequestInput,
  PullRequestLink,
  SectionChange,
} from '../models/artifact.model.js';
import { type ArtifactTransaction, IArtifactStorePort } from '../ports/artifact-store.port.js';
import { ArtifactEventsService } from '../services/artifact-events.service.js';
import { ArtifactHistoryService } from '../services/artifact-history.service.js';
import { ArtifactRulesService } from '../services/artifact-rules.service.js';


type Draft = { -readonly [K in keyof Artifact]: Artifact[K] };

const NONE = 'none';

/** Applies the changes all together or none of them; a change that sets what is already there is not recorded. */
@Injectable()
export class UpdateArtifactUseCase {
  constructor(
    @Inject(IArtifactStorePort) private readonly store: IArtifactStorePort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    private readonly rules: ArtifactRulesService,
    private readonly history: ArtifactHistoryService,
    private readonly events: ArtifactEventsService,
  ) {}

  async execute(conversationId: string, id: string, changes: ArtifactChanges, actor: ArtifactActor): Promise<ArtifactOutcome & { readonly changed?: boolean }> {
    const folders = changes.projectName === undefined ? [] : await this.workspace.listProjectFolders();
    const outcome = await this.store.transaction(conversationId, (transaction) => {
      const current = transaction.find(id);
      if (!current) {
        return { ok: false as const, error: `Unknown artifact "${id}".` };
      }
      const draft: Draft = { ...current };
      const recorded: ArtifactFieldChange[] = [];
      const error = this.applyFields(transaction, draft, changes, recorded, folders)
        ?? this.applyPullRequests(draft, changes.pullRequests ?? [], recorded);
      this.applySections(draft, changes.sections ?? [], recorded);
      if (error) {
        return { ok: false as const, error };
      }
      if (recorded.length === 0) {
        return { ok: true as const, artifact: current, changed: false };
      }
      const artifact: Artifact = {
        ...draft,
        updatedAt: this.history.now(),
        history: [
          ...current.history,
          this.history.event(actor, 'updated', this.summarize(recorded), { changes: recorded, text: changes.note?.trim() }),
        ],
      };
      transaction.save(artifact);
      return { ok: true as const, artifact, changed: true };
    });
    if (outcome.ok && outcome.changed) {
      this.events.publish([{ kind: 'saved', conversationId, artifact: outcome.artifact }]);
    }
    return outcome;
  }

  private applyFields(
    transaction: ArtifactTransaction,
    draft: Draft,
    changes: ArtifactChanges,
    recorded: ArtifactFieldChange[],
    folders: readonly string[],
  ): string | undefined {
    const originalParentId = draft.parentId;
    if (changes.title !== undefined && changes.title.trim() !== draft.title) {
      const title = changes.title.trim();
      const error = this.rules.checkTitle(title);
      if (error) {
        return error;
      }
      recorded.push({ field: 'title', from: draft.title, to: title });
      draft.title = title;
    }
    if (changes.status !== undefined && changes.status !== draft.status) {
      recorded.push({ field: 'status', from: draft.status, to: changes.status });
      draft.status = changes.status;
    }
    if (changes.parentId !== undefined && changes.parentId !== draft.parentId) {
      const error = this.rules.checkParent(transaction, draft.type, changes.parentId);
      if (error) {
        return error;
      }
      recorded.push({ field: 'parent', from: draft.parentId ?? NONE, to: changes.parentId ?? NONE });
      draft.parentId = changes.parentId;
    }
    if (changes.projectName !== undefined && changes.projectName.trim() !== draft.projectName) {
      const projectName = changes.projectName.trim();
      const children = transaction.list().filter(artifact => artifact.parentId === draft.id);
      const error = this.rules.checkProject(projectName, folders)
        ?? (children.length > 0 ? `${draft.id} has ${children.map(child => child.id).join(', ')} under it, which stay in its project; move them first.` : undefined);
      if (error) {
        return error;
      }
      recorded.push({ field: 'project', from: draft.projectName, to: projectName });
      draft.projectName = projectName;
    }
    if (changes.parentId !== undefined || changes.projectName !== undefined) {
      const error = this.rules.checkSameProject(transaction, draft.parentId, draft.projectName);
      if (error) {
        return error;
      }
    }
    const moved = draft.parentId !== originalParentId;
    if (changes.dependsOn !== undefined || moved) {
      const dependsOn = [...new Set(changes.dependsOn ?? draft.dependsOn)];
      const error = this.rules.checkDependencies(transaction, draft, dependsOn)
        ?? (moved ? this.rules.checkDependents(transaction, draft) : undefined);
      if (error) {
        return error;
      }
      if (dependsOn.join(',') !== draft.dependsOn.join(',')) {
        recorded.push({ field: 'depends_on', from: draft.dependsOn.join(', ') || NONE, to: dependsOn.join(', ') || NONE });
        draft.dependsOn = dependsOn;
      }
    }
    for (const side of ['business', 'technical'] as const) {
      const state = changes.refinement?.[side];
      if (state !== undefined && state !== draft.refinement[side]) {
        recorded.push({ field: `${side}_refinement`, from: draft.refinement[side], to: state });
        draft.refinement = { ...draft.refinement, [side]: state };
      }
    }
    if (changes.branch !== undefined) {
      const branch = changes.branch?.trim() || null;
      if (branch !== draft.branch) {
        recorded.push({ field: 'branch', from: draft.branch ?? NONE, to: branch ?? NONE });
        draft.branch = branch;
      }
    }
    return undefined;
  }

  private applySections(draft: Draft, changes: readonly SectionChange[], recorded: ArtifactFieldChange[]): void {
    const sections: Partial<Record<keyof ArtifactSections, string>> = { ...draft.sections };
    for (const { section, content, mode } of changes) {
      const existing = sections[section] ?? '';
      const text = content.trim();
      const next = mode === 'append' ? [existing, text].filter(Boolean).join('\n\n') : text;
      if (next === existing) {
        continue;
      }
      if (next) {
        sections[section] = next;
      } else {
        delete sections[section];
      }
      recorded.push({ field: `section:${section}`, to: !next ? 'cleared' : mode === 'append' && existing ? 'appended' : 'replaced' });
    }
    draft.sections = sections;
  }

  private applyPullRequests(draft: Draft, links: readonly PullRequestInput[], recorded: ArtifactFieldChange[]): string | undefined {
    const pullRequests: PullRequestLink[] = [...draft.pullRequests];
    for (const link of links) {
      const url = link.url.trim();
      const error = this.rules.checkPullRequestUrl(url);
      if (error) {
        return error;
      }
      const index = pullRequests.findIndex(existing => existing.url === url);
      const previous = index >= 0 ? pullRequests[index] : undefined;
      const title = link.title?.trim() || previous?.title;
      const updated: PullRequestLink = {
        url,
        ...(title ? { title } : {}),
        state: link.state ?? previous?.state ?? 'open',
        addedAt: previous?.addedAt ?? this.history.now(),
      };
      if (previous && previous.state === updated.state && previous.title === updated.title) {
        continue;
      }
      if (previous) {
        pullRequests[index] = updated;
      } else {
        pullRequests.push(updated);
      }
      recorded.push({ field: 'pull_request', ...(previous ? { from: previous.state } : {}), to: `${url} (${updated.state})` });
    }
    draft.pullRequests = pullRequests;
    return undefined;
  }

  private summarize(changes: readonly ArtifactFieldChange[]): string {
    const status = changes.find(change => change.field === 'status');
    const fields = [...new Set(changes.map(change => change.field.replace(/^section:/, '').replace(/_/g, ' ')))];
    return status
      ? `Status ${status.from} → ${status.to}${fields.length > 1 ? `; updated ${fields.filter(field => field !== 'status').join(', ')}` : ''}`
      : `Updated ${fields.join(', ')}`;
  }
}
