import { Injectable } from '@nestjs/common';

import { ACTIVE_TASK_STATUSES, ARTIFACT_PARENT_TYPES, CLOSED_ARTIFACT_STATUSES, REFINEMENT_KINDS } from '../constants/artifact-catalog.constant.js';
import type { Artifact, ArtifactRefinement, ArtifactStatus, ArtifactType } from '../models/artifact.model.js';
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
      return 'A project is a folder of the workspace root: name it.';
    }
    if (folders.includes(projectName)) {
      return undefined;
    }
    return folders.length > 0
      ? `Unknown project "${projectName}". Use one of the project folders exactly as written: ${folders.join(', ')}.`
      : `Unknown project "${projectName}": the workspace root has no project folder yet.`;
  }

  /** A feature links at least one project, each an existing project folder. */
  checkProjects(projectNames: readonly string[], folders: readonly string[]): string | undefined {
    if (projectNames.length === 0) {
      return 'A feature links at least one project: name its project folders.';
    }
    for (const projectName of projectNames) {
      const error = this.checkProject(projectName, folders);
      if (error) {
        return error;
      }
    }
    return undefined;
  }

  /** The project a task takes when it names none: its feature's, when that links only one. */
  defaultTaskProject(transaction: ArtifactTransaction, parentId: string | null): string | undefined {
    const projectNames = (parentId ? transaction.find(parentId) : undefined)?.projectNames;
    return projectNames?.length === 1 ? projectNames[0] : undefined;
  }

  /** A task works in one project, and under a feature one the feature links; a feature with several leaves the choice to the task. */
  checkTaskProject(transaction: ArtifactTransaction, parentId: string | null, projectName: string, folders: readonly string[]): string | undefined {
    const parent = parentId ? transaction.find(parentId) : undefined;
    if (!projectName && parent) {
      return `${parent.id} links the projects ${this.quoted(parent.projectNames)}: name the one this task works in.`;
    }
    return this.checkProject(projectName, folders) ?? this.checkProjectOfFeature(parent, projectName);
  }

  /** The project of a task under `parent`, when it has one, is one of the parent's. */
  checkProjectOfFeature(parent: Artifact | undefined, projectName: string): string | undefined {
    return parent && !parent.projectNames.includes(projectName)
      ? `"${projectName}" is not one of the projects of ${parent.id} (${this.quoted(parent.projectNames)}): a task works in one of them. Add the project to ${parent.id} first.`
      : undefined;
  }

  /** The new projects of a feature are valid and keep every project its tasks work in. */
  checkFeatureProjects(transaction: ArtifactTransaction, feature: Artifact, projectNames: readonly string[], folders: readonly string[]): string | undefined {
    const error = this.checkProjects(projectNames, folders);
    if (error) {
      return error;
    }
    const stranded = transaction.list().filter(task => task.parentId === feature.id && task.projectName !== null && !projectNames.includes(task.projectName));
    if (stranded.length === 0) {
      return undefined;
    }
    const used = [...new Set(stranded.map(task => task.projectName!))];
    return `${feature.id} still has tasks in ${this.quoted(used)} (${stranded.map(task => task.id).join(', ')}), so it keeps ${used.length === 1 ? 'that project' : 'those projects'}: move the tasks to another project of the feature first.`;
  }

  checkPullRequestUrl(url: string): string | undefined {
    return PULL_REQUEST_URL.test(url) ? undefined : `"${url}" is not a pull request URL: use its full http(s) address.`;
  }

  /** The repository is a path inside the project folder of the task, so it neither starts at the root nor climbs out. */
  checkPullRequestRepository(repository: string): string | undefined {
    const climbs = repository.split('/').includes('..');
    return repository.startsWith('/') || /^[a-z]:/i.test(repository) || climbs
      ? `"${repository}" is not a repository path: give it relative to the project folder of the task, "." for the folder itself.`
      : undefined;
  }

  owesRefinement(refinement: ArtifactRefinement): boolean {
    return REFINEMENT_KINDS.some(kind => refinement[kind] === 'pending');
  }

  /**
   * A task is `ready` exactly when no refinement is pending: a `backlog` task that owes none becomes `ready`, and a
   * `ready` one that owes one goes back to the `backlog`. A refined task is parked with `blocked`, which is left alone.
   */
  derivedTaskStatus(task: Artifact): ArtifactStatus | undefined {
    if (task.type !== 'task') {
      return undefined;
    }
    const owes = this.owesRefinement(task.refinement);
    if (task.status === 'backlog' && !owes) {
      return 'ready';
    }
    return task.status === 'ready' && owes ? 'backlog' : undefined;
  }

  /**
   * A feature follows its tasks: `in_progress` while one is under way or done and another is still open, `done` once
   * every task is closed and one of them is done. `blocked`, `frozen` and `cancelled` are decisions of whoever set them,
   * and a feature without tasks has nothing to follow.
   */
  derivedFeatureStatus(feature: Artifact, tasks: readonly Artifact[]): ArtifactStatus | undefined {
    if (feature.type !== 'feature' || tasks.length === 0) {
      return undefined;
    }
    const allClosed = tasks.every(task => CLOSED_ARTIFACT_STATUSES.includes(task.status));
    if (allClosed) {
      return tasks.some(task => task.status === 'done') && ['backlog', 'ready', 'in_progress'].includes(feature.status) ? 'done' : undefined;
    }
    const underway = tasks.some(task => task.status === 'done' || ACTIVE_TASK_STATUSES.includes(task.status));
    return underway && ['backlog', 'ready', 'done'].includes(feature.status) ? 'in_progress' : undefined;
  }

  private quoted(names: readonly string[]): string {
    return names.map(name => `"${name}"`).join(', ');
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
