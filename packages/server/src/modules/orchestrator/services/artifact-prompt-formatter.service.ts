import { Injectable } from '@nestjs/common';

import { ARTIFACT_SECTION_TITLES, ARTIFACT_SECTIONS, CLOSED_ARTIFACT_STATUSES, REFINEMENT_KINDS } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactActor, ArtifactHistoryEvent, ArtifactSection } from '../../artifacts/models/artifact.model.js';
import { lastStatusChange } from '../../artifacts/utils/artifact-status.util.js';


/** Renders artifacts as the Markdown agents read: the lines of a listing, the full content of one artifact and what changed on it. */
@Injectable()
export class ArtifactPromptFormatterService {
  /** `all` is the whole board, which names the parents and dependencies the line points to. */
  summaryLine(artifact: Artifact, all: readonly Artifact[]): string {
    const waitingOn = this.waitingOn(artifact, all);
    const parts = [
      `- ${artifact.id} [${artifact.type}] "${artifact.title}"`,
      `status: ${artifact.status}`,
      `project: ${artifact.projectName}`,
      ...(artifact.parentId ? [`parent: ${artifact.parentId}`] : []),
      ...(artifact.dependsOn.length > 0 ? [`depends on: ${artifact.dependsOn.map(id => `${id} (${this.find(all, id)?.status ?? 'deleted'})`).join(', ')}`] : []),
      ...(waitingOn.length > 0 ? [`waiting on: ${waitingOn.join(', ')}`] : []),
      `refinement: ${this.refinementStates(artifact)}`,
      ...(artifact.assignee ? [`with: ${artifact.assignee.role}`] : []),
      ...(artifact.pullRequests.length > 0 ? [`pull requests: ${artifact.pullRequests.length}`] : []),
    ];
    return parts.join(' · ');
  }

  list(artifacts: readonly Artifact[], all: readonly Artifact[]): string {
    return artifacts.length === 0 ? 'No artifact matches.' : artifacts.map(artifact => this.summaryLine(artifact, all)).join('\n');
  }

  /**
   * The whole board in brief: a compact line for each open artifact that is not a `ready` or `backlog` task (features
   * first, then tasks, in id order), then the `ready` tasks by feature and the `backlog` tasks with the refinement each
   * still owes.
   */
  digest(all: readonly Artifact[]): string {
    const open = all.filter(artifact => !CLOSED_ARTIFACT_STATUSES.includes(artifact.status)).sort((a, b) => this.compareIds(a, b));
    const tasksIn = (...statuses: readonly string[]) => open.filter(artifact => artifact.type === 'task' && statuses.includes(artifact.status));
    const ready = tasksIn('ready');
    const backlog = tasksIn('backlog');
    const features = open.filter(artifact => artifact.type === 'feature');
    const underway = open.filter(artifact => artifact.type === 'task' && !['ready', 'backlog'].includes(artifact.status));
    const lines = [
      ...features.map(feature => this.featureDigestLine(feature)),
      ...underway.map(task => this.taskDigestLine(task, all)),
      ...(ready.length > 0 ? [`Ready: ${this.readyGroups(ready)}`] : []),
      ...(backlog.length > 0 ? [`Backlog: ${backlog.map(task => this.backlogEntry(task)).join('; ')}`] : []),
    ];
    return lines.length > 0 ? lines.join('\n') : 'No open artifact.';
  }

  /** With `tree`, every descendant follows in full, depth first; without it, the direct children are listed. */
  detail(artifact: Artifact, all: readonly Artifact[], tree = false): string {
    const own = this.render(artifact, all, !tree);
    if (!tree) {
      return own;
    }
    return [own, ...this.descendants(artifact.id, all).map(descendant => this.render(descendant, all, false))].join('\n\n---\n\n');
  }

  /**
   * The facts of the artifact and only the sections changed and the comments added from `since` on, for a session that
   * worked on it until then. Events at that very moment count, so a change is never left out.
   */
  changesSince(artifact: Artifact, all: readonly Artifact[], since: string): string {
    const recent = artifact.history.filter(event => event.at >= since);
    const changedSections = new Set(recent.flatMap(event => (event.changes ?? []).map(change => change.field)));
    const sections = ARTIFACT_SECTIONS
      .filter(section => changedSections.has(`section:${section}`))
      .map(section => this.renderSection(artifact, section));
    const comments = this.renderComments(recent);
    const changed = sections.length > 0 || comments !== undefined;
    return [
      `# ${artifact.id} · ${artifact.title}`,
      [
        this.statusFact(artifact),
        this.dependenciesFact(artifact, all),
        this.refinementFact(artifact),
        this.holderFact(artifact),
        this.branchFact(artifact),
        this.pullRequestsFact(artifact),
      ].join('\n'),
      changed
        ? `Below are only the sections changed and the comments added since you last worked on ${artifact.id}; everything else on it is unchanged.`
        : `Nothing on ${artifact.id} besides the facts above changed since you last worked on it.`,
      ...sections,
      ...(comments ? [comments] : []),
    ].join('\n\n');
  }

  private render(artifact: Artifact, all: readonly Artifact[], withChildren: boolean): string {
    const children = all.filter(other => other.parentId === artifact.id);
    const blocks = all.filter(other => other.dependsOn.includes(artifact.id));
    const facts = [
      `- Type: ${artifact.type}`,
      this.statusFact(artifact),
      `- Project: ${artifact.projectName}`,
      `- Parent: ${this.ancestry(artifact, all)}`,
      this.dependenciesFact(artifact, all),
      `- Blocks: ${this.references(blocks)}`,
      this.refinementFact(artifact),
      this.holderFact(artifact),
      this.branchFact(artifact),
      this.pullRequestsFact(artifact),
      ...(withChildren && children.length > 0 ? [`- Children:\n${children.map(child => `  ${this.summaryLine(child, all)}`).join('\n')}`] : []),
    ];
    const sections = ARTIFACT_SECTIONS
      .filter(section => artifact.sections[section])
      .map(section => this.renderSection(artifact, section));
    const comments = this.renderComments(artifact.history);
    return [
      `# ${artifact.id} · ${artifact.title}`,
      facts.join('\n'),
      ...(sections.length > 0 ? sections : ['No section written yet.']),
      ...(comments ? [comments] : []),
    ].join('\n\n');
  }

  private renderSection(artifact: Artifact, section: ArtifactSection): string {
    return `## ${ARTIFACT_SECTION_TITLES[section]}\n${artifact.sections[section] || 'Cleared.'}`;
  }

  private renderComments(history: readonly ArtifactHistoryEvent[]): string | undefined {
    const comments = history
      .filter(event => event.kind === 'commented')
      .map(event => `- ${event.at} ${this.actorLabel(event.actor)}: ${event.text}`);
    return comments.length > 0 ? `## Comments\n${comments.join('\n')}` : undefined;
  }

  private statusFact(artifact: Artifact): string {
    return `- Status: ${artifact.status}${lastStatusChange(artifact)?.event.actor.kind === 'user' ? ', set by the user' : ''}`;
  }

  private dependenciesFact(artifact: Artifact, all: readonly Artifact[]): string {
    return `- Depends on: ${this.references(artifact.dependsOn.map(id => this.find(all, id) ?? id))}`;
  }

  private refinementFact(artifact: Artifact): string {
    return `- Refinement: ${this.refinementStates(artifact)}`;
  }

  private refinementStates(artifact: Artifact): string {
    return REFINEMENT_KINDS.map(kind => `${kind} ${artifact.refinement[kind]}`).join(', ');
  }

  private holderFact(artifact: Artifact): string {
    return `- With: ${artifact.assignee ? `${artifact.assignee.roleName} (${artifact.assignee.role}) since ${artifact.assignee.since}` : 'nobody'}`;
  }

  private branchFact(artifact: Artifact): string {
    return `- Branch: ${artifact.branch ?? 'none'}`;
  }

  private pullRequestsFact(artifact: Artifact): string {
    return `- Pull requests: ${artifact.pullRequests.length > 0 ? artifact.pullRequests.map(link => `${link.url} (${link.state})${link.title ? ` "${link.title}"` : ''}`).join('; ') : 'none'}`;
  }

  private featureDigestLine(feature: Artifact): string {
    return `- ${feature.id} [feature] "${feature.title}" · status: ${feature.status} · project: ${feature.projectName}`;
  }

  /** A task under a feature runs in the feature's project, so the line names the feature, and the project only for a standalone task. */
  private taskDigestLine(task: Artifact, all: readonly Artifact[]): string {
    const waitingOn = this.waitingOn(task, all);
    return [
      `- ${task.id} [task] "${task.title}"`,
      `status: ${task.status}`,
      task.parentId ? `feature: ${task.parentId}` : `project: ${task.projectName}`,
      ...(task.assignee ? [`with: ${task.assignee.role}`] : []),
      ...(waitingOn.length > 0 ? [`waiting on: ${waitingOn.join(', ')}`] : []),
      ...(task.pullRequests.length > 0 ? [`pull requests: ${task.pullRequests.length}`] : []),
    ].join(' · ');
  }

  /** The ids grouped by feature in the id order of the features, the tasks without a feature last. */
  private readyGroups(tasks: readonly Artifact[]): string {
    const featureIds = [...new Set(tasks.flatMap(task => (task.parentId ? [task.parentId] : [])))].sort((a, b) => this.compareIds({ id: a }, { id: b }));
    const groups = featureIds.map(featureId => `${tasks.filter(task => task.parentId === featureId).map(task => task.id).join(', ')} (${featureId})`);
    const standalone = tasks.filter(task => !task.parentId).map(task => task.id);
    return [...groups, ...(standalone.length > 0 ? [standalone.join(', ')] : [])].join('; ');
  }

  private backlogEntry(task: Artifact): string {
    const owed = REFINEMENT_KINDS.filter(kind => task.refinement[kind] === 'pending');
    const notes = [...(task.parentId ? [task.parentId] : []), ...(owed.length > 0 ? [`owes ${owed.join(' and ')}`] : [])];
    return notes.length > 0 ? `${task.id} (${notes.join(', ')})` : task.id;
  }

  private compareIds(a: { readonly id: string }, b: { readonly id: string }): number {
    return Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]) || a.id.localeCompare(b.id);
  }

  /** The dependencies still open, which keep the work from starting. */
  private waitingOn(artifact: Artifact, all: readonly Artifact[]): string[] {
    return artifact.dependsOn.filter((id) => {
      const dependency = this.find(all, id);
      return dependency !== undefined && !CLOSED_ARTIFACT_STATUSES.includes(dependency.status);
    });
  }

  private ancestry(artifact: Artifact, all: readonly Artifact[]): string {
    const chain: string[] = [];
    const seen = new Set<string>();
    for (let parent = artifact.parentId ? this.find(all, artifact.parentId) : undefined; parent && !seen.has(parent.id); parent = parent.parentId ? this.find(all, parent.parentId) : undefined) {
      seen.add(parent.id);
      chain.push(`${parent.id} "${parent.title}" (${parent.type})`);
    }
    return chain.length > 0 ? chain.join(' › ') : 'none';
  }

  private references(artifacts: readonly (Artifact | string)[]): string {
    if (artifacts.length === 0) {
      return 'none';
    }
    return artifacts
      .map(artifact => (typeof artifact === 'string' ? `${artifact} (deleted)` : `${artifact.id} "${artifact.title}" (${artifact.status})`))
      .join('; ');
  }

  private descendants(id: string, all: readonly Artifact[]): Artifact[] {
    return all
      .filter(artifact => artifact.parentId === id)
      .flatMap(child => [child, ...this.descendants(child.id, all)]);
  }

  private actorLabel(actor: ArtifactActor): string {
    if (actor.kind === 'agent') {
      return actor.role;
    }
    return actor.kind === 'user' ? `user (${actor.channel})` : 'system';
  }

  private find(all: readonly Artifact[], id: string): Artifact | undefined {
    return all.find(artifact => artifact.id === id);
  }
}
