import { Injectable } from '@nestjs/common';

import { ARTIFACT_SECTION_TITLES, ARTIFACT_SECTIONS, CLOSED_ARTIFACT_STATUSES } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactActor } from '../../artifacts/models/artifact.model.js';


/** Renders artifacts as the Markdown agents read: the lines of a listing and the full content of one artifact. */
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
      `refinement: business ${artifact.refinement.business}, technical ${artifact.refinement.technical}`,
      ...(artifact.assignee ? [`with: ${artifact.assignee.role}`] : []),
      ...(artifact.pullRequests.length > 0 ? [`pull requests: ${artifact.pullRequests.length}`] : []),
    ];
    return parts.join(' · ');
  }

  list(artifacts: readonly Artifact[], all: readonly Artifact[]): string {
    return artifacts.length === 0 ? 'No artifact matches.' : artifacts.map(artifact => this.summaryLine(artifact, all)).join('\n');
  }

  /** With `tree`, every descendant follows in full, depth first; without it, the direct children are listed. */
  detail(artifact: Artifact, all: readonly Artifact[], tree = false): string {
    const own = this.render(artifact, all, !tree);
    if (!tree) {
      return own;
    }
    return [own, ...this.descendants(artifact.id, all).map(descendant => this.render(descendant, all, false))].join('\n\n---\n\n');
  }

  private render(artifact: Artifact, all: readonly Artifact[], withChildren: boolean): string {
    const children = all.filter(other => other.parentId === artifact.id);
    const blocks = all.filter(other => other.dependsOn.includes(artifact.id));
    const facts = [
      `- Type: ${artifact.type}`,
      `- Status: ${artifact.status}`,
      `- Project: ${artifact.projectName}`,
      `- Parent: ${this.ancestry(artifact, all)}`,
      `- Depends on: ${this.references(artifact.dependsOn.map(id => this.find(all, id) ?? id))}`,
      `- Blocks: ${this.references(blocks)}`,
      `- Refinement: business ${artifact.refinement.business}, technical ${artifact.refinement.technical}`,
      `- With: ${artifact.assignee ? `${artifact.assignee.roleName} (${artifact.assignee.role}) since ${artifact.assignee.since}` : 'nobody'}`,
      `- Branch: ${artifact.branch ?? 'none'}`,
      `- Pull requests: ${artifact.pullRequests.length > 0 ? artifact.pullRequests.map(link => `${link.url} (${link.state})${link.title ? ` "${link.title}"` : ''}`).join('; ') : 'none'}`,
      ...(withChildren && children.length > 0 ? [`- Children:\n${children.map(child => `  ${this.summaryLine(child, all)}`).join('\n')}`] : []),
    ];
    const sections = ARTIFACT_SECTIONS
      .filter(section => artifact.sections[section])
      .map(section => `## ${ARTIFACT_SECTION_TITLES[section]}\n${artifact.sections[section]}`);
    const comments = artifact.history
      .filter(event => event.kind === 'commented')
      .map(event => `- ${event.at} ${this.actorLabel(event.actor)}: ${event.text}`);
    return [
      `# ${artifact.id} · ${artifact.title}`,
      facts.join('\n'),
      ...(sections.length > 0 ? sections : ['No section written yet.']),
      ...(comments.length > 0 ? [`## Comments\n${comments.join('\n')}`] : []),
    ].join('\n\n');
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
