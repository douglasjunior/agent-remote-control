import { Injectable } from '@nestjs/common';

import { ARTIFACT_PARENT_TYPES } from '../constants/artifact-catalog.constant.js';
import type { ArtifactType } from '../models/artifact.model.js';
import type { ArtifactTransaction } from '../ports/artifact-store.port.js';


const MAX_TITLE_LENGTH = 200;
const PULL_REQUEST_URL = /^https?:\/\/\S+$/;

/** Where an artifact sits: what decides which artifacts it may depend on. */
export type ArtifactPlace = {
  readonly id?: string;
  readonly type: ArtifactType;
  readonly parentId: string | null;
};

/** The invariants of the board, checked against the transaction that is about to change it. Each check returns the error, if any. */
@Injectable()
export class ArtifactRulesService {
  checkTitle(title: string): string | undefined {
    if (!title) {
      return 'An artifact needs a title.';
    }
    return title.length > MAX_TITLE_LENGTH ? `A title has at most ${MAX_TITLE_LENGTH} characters.` : undefined;
  }

  /** Two levels only, a feature over its tasks, so a parent can never be its own descendant. */
  checkParent(transaction: ArtifactTransaction, type: ArtifactType, parentId: string | null): string | undefined {
    const allowed = ARTIFACT_PARENT_TYPES[type];
    if (parentId === null) {
      return undefined;
    }
    if (allowed.length === 0) {
      return `A ${type} is always at the top of the board, so it takes no parent.`;
    }
    const parent = transaction.find(parentId);
    if (!parent) {
      return `Unknown parent artifact "${parentId}".`;
    }
    return allowed.includes(parent.type)
      ? undefined
      : `A ${type} goes under a ${allowed.join(' or ')}, and ${parentId} is a ${parent.type}.`;
  }

  /**
   * Dependencies order siblings: a feature depends on other features, and a task on the other tasks of its feature
   * (a standalone task, on other standalone tasks). Work across features is ordered by the features themselves.
   * `id` is absent for an artifact being created.
   */
  checkDependencies(transaction: ArtifactTransaction, artifact: ArtifactPlace, dependsOn: readonly string[]): string | undefined {
    const { id } = artifact;
    for (const dependency of dependsOn) {
      if (dependency === id) {
        return `${id} cannot depend on itself.`;
      }
      const target = transaction.find(dependency);
      if (!target) {
        return `Unknown dependency "${dependency}".`;
      }
      if (target.type !== artifact.type || target.parentId !== artifact.parentId) {
        return `${dependency} cannot be a dependency here: ${this.siblingRule(artifact)}`;
      }
      if (id && this.reaches(transaction, dependency, id)) {
        return `${id} cannot depend on ${dependency}, because ${dependency} already depends on ${id}.`;
      }
    }
    return undefined;
  }

  /** An artifact that moves to another feature must not leave behind the siblings that depend on it. */
  checkDependents(transaction: ArtifactTransaction, artifact: Required<ArtifactPlace>): string | undefined {
    const dependents = transaction.list()
      .filter(other => other.dependsOn.includes(artifact.id) && other.parentId !== artifact.parentId)
      .map(other => other.id);
    return dependents.length > 0
      ? `${dependents.join(', ')} depend${dependents.length === 1 ? 's' : ''} on ${artifact.id}, and dependencies stay among siblings: remove ${dependents.length === 1 ? 'that dependency' : 'those dependencies'} before moving ${artifact.id}.`
      : undefined;
  }

  /** `folders` are the project folders of the workspace root, the only values a project takes. */
  checkProject(projectName: string, folders: readonly string[]): string | undefined {
    if (!projectName) {
      return 'An artifact belongs to a project: name its project folder.';
    }
    if (folders.includes(projectName)) {
      return undefined;
    }
    return folders.length > 0
      ? `Unknown project "${projectName}". Use one of the project folders exactly as written: ${folders.join(', ')}.`
      : `Unknown project "${projectName}": the workspace root has no project folder yet.`;
  }

  /** A task under a feature always has the feature's project, so a feature groups the work of one project. */
  checkSameProject(transaction: ArtifactTransaction, parentId: string | null, projectName: string): string | undefined {
    const parent = parentId ? transaction.find(parentId) : undefined;
    return parent && parent.projectName !== projectName
      ? `${parent.id} belongs to project "${parent.projectName}", so its tasks belong there too, not to "${projectName}". Work in another project goes in a feature of that project.`
      : undefined;
  }

  checkPullRequestUrl(url: string): string | undefined {
    return PULL_REQUEST_URL.test(url) ? undefined : `"${url}" is not a pull request URL: use its full http(s) address.`;
  }

  private siblingRule({ type, parentId }: ArtifactPlace): string {
    if (type === 'feature') {
      return 'a feature depends only on other features.';
    }
    return parentId ? `a task depends only on other tasks of its feature, ${parentId}.` : 'a standalone task depends only on other standalone tasks.';
  }

  /** Whether `fromId` depends on `targetId`, directly or through other dependencies. */
  private reaches(transaction: ArtifactTransaction, fromId: string, targetId: string): boolean {
    const pending = [fromId];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === targetId) {
        return true;
      }
      if (!seen.has(current)) {
        seen.add(current);
        pending.push(...transaction.find(current)?.dependsOn ?? []);
      }
    }
    return false;
  }
}
