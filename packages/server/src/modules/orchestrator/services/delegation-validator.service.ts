import { Inject, Injectable } from '@nestjs/common';

import { CLOSED_ARTIFACT_STATUSES, FROZEN_STATUS } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { Artifact } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { ValidatedDecision, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { type DelegationContract, IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { buildBusyRoleRepair, type BusyRoleReason } from '../prompts/busy-role.prompt.js';
import { startsNewTaskSession } from '../utils/delegation-session.util.js';

import { ConversationRuntimeService } from './conversation-runtime.service.js';
import { type DelegationResult, DelegationDetectorService } from './delegation-detector.service.js';
import { DelegationLimitsConfigService } from './delegation-limits-config.service.js';
import { DelegationStatusService } from './delegation-status.service.js';
import { SteeringSupportService } from './steering-support.service.js';


/** Checks the delegations of a CEO response against the team, the board, the workspace and the agents already running. */
@Injectable()
export class DelegationValidatorService {
  constructor(
    private readonly delegationDetector: DelegationDetectorService,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    @Inject(IWorkspacePort) private readonly workspacePort: IWorkspacePort,
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly delegationStatus: DelegationStatusService,
    private readonly limits: DelegationLimitsConfigService,
    private readonly steeringSupport: SteeringSupportService,
  ) {}

  /** Reads the CEO response and checks every delegation in it, so an invalid one goes back to the CEO before any agent starts. */
  async decide(response: string, request: TurnRequest, userInitiated: boolean): Promise<ValidatedDecision> {
    const decision = this.delegationDetector.detect(response);
    if (decision.kind !== 'delegate') {
      return decision;
    }

    const delegations: ValidatedDelegation[] = [];
    for (const delegation of decision.delegations) {
      const validated = await this.validateDelegation(delegation, request, userInitiated);
      if ('reason' in validated) {
        return { kind: 'invalid', reason: validated.reason };
      }
      delegations.push(validated);
    }

    const conflict = await this.findParallelConflict(delegations, request.conversationId);
    return conflict ? { kind: 'invalid', reason: conflict } : { kind: 'delegate', message: decision.message, delegations };
  }

  private async validateDelegation(
    delegation: DelegationResult,
    request: TurnRequest,
    userInitiated: boolean,
  ): Promise<ValidatedDelegation | { readonly reason: string }> {
    const { delegateToRole } = delegation;
    if (delegateToRole === request.agentRole.toUpperCase() || !this.agentRegistry.hasRole(delegateToRole)) {
      return { reason: `Unknown role "${delegateToRole}". Delegate only to a role listed in Your Team.` };
    }

    const contract = this.agentRegistry.getDelegationContract(delegateToRole);
    if (contract.userInitiatedOnly && !userInitiated) {
      return { reason: `${delegateToRole} is delegated to only on the user's decision. Suggest it to the user with a <question> and delegate only after the user agrees or asks for it explicitly.` };
    }
    const withArtifact = await this.applyArtifact(delegation, contract, request.conversationId);
    if ('reason' in withArtifact) {
      return withArtifact;
    }
    const violation = this.checkDelegationContract(delegateToRole, contract, withArtifact) ?? this.checkBusyRole(withArtifact, request.conversationId);
    if (violation) {
      return { reason: violation };
    }
    return this.resolveDelegationFolder(withArtifact, request);
  }

  /**
   * A delegation names the artifact its agent works on. A task's agent runs in the task's project: the folder may be
   * left out, and a different one is a mistake. A feature's agent runs at the workspaces root and changes files in the
   * feature's projects, which are its scope, so a folder is a mistake too. The artifact must be open, of a type the
   * agent works on, in a status the agent takes, ready for it and with no agent of another role holding it, because an
   * artifact is with one agent at a time. The agent receives the artifact in full, so the specification only names the
   * step.
   */
  private async applyArtifact(
    delegation: DelegationResult,
    contract: DelegationContract,
    conversationId: string,
  ): Promise<DelegationResult | { readonly reason: string }> {
    const { delegateToRole: role, artifactId, projectName } = delegation;
    if (!artifactId) {
      return contract.artifact === 'required'
        ? { reason: `${role} works on a task of the board: add artifact="<task id>" to the <delegate> tag, creating the task first when it does not exist.` }
        : delegation;
    }
    if (!contract.artifact) {
      return { reason: `Role "${role}" does not take an artifact. Leave the artifact attribute out.` };
    }
    const artifact = await this.artifacts.get(conversationId, artifactId);
    if (!artifact) {
      return { reason: `Unknown artifact "${artifactId}". List the artifacts of the board to find the right id, or create it first.` };
    }
    if (this.agentRegistry.getArtifactAccess(role).scope === 'task' && artifact.type !== 'task') {
      return { reason: `${role} works on tasks only, and ${artifactId} is a ${artifact.type}. Delegate one of its tasks.` };
    }
    if (artifact.status === FROZEN_STATUS) {
      return { reason: `${artifactId} is frozen after too many delegations, and only the user takes it out. Tell the user what is going wrong with it instead of delegating it.` };
    }
    if (CLOSED_ARTIFACT_STATUSES.includes(artifact.status)) {
      return { reason: `${artifactId} is ${artifact.status}. Set its status back to an open one before delegating work on it.` };
    }
    const outOfOrder = this.delegationStatus.refusal(role, artifact);
    if (outOfOrder) {
      return { reason: outOfOrder };
    }
    if (contract.needsReviewableWork && artifact.pullRequests.length === 0 && !artifact.branch) {
      return { reason: `${role} inspects the work of ${artifactId}, which has neither a pull request nor a branch yet. Record the branch of its implementation first.` };
    }
    if (artifact.assignee && artifact.assignee.role !== role) {
      return { reason: `${artifactId} is with ${artifact.assignee.role} right now, and an artifact is with one agent at a time. Wait for its result, or redirect that agent.` };
    }
    if (artifact.type === 'feature') {
      if (projectName) {
        return { reason: `${artifactId} is a feature, so its projects (${artifact.projectNames.join(', ')}) define where the work runs: leave the project attribute out.` };
      }
      const missing = await this.missingProjectFolders(artifact);
      if (missing) {
        return { reason: missing };
      }
    } else if (projectName && projectName !== artifact.projectName) {
      return { reason: `${artifactId} belongs to project "${artifact.projectName}", so the work on it runs there: use project="${artifact.projectName}" or leave the project out.` };
    }
    const maxSpecChars = this.limits.getMaxSpecChars();
    if (maxSpecChars > 0 && delegation.taskSpec.length > maxSpecChars && !this.redirects(conversationId, delegation)) {
      return { reason: `The specification of ${artifactId} has ${delegation.taskSpec.length} characters, and the limit with an artifact is ${maxSpecChars}. The agent receives ${artifactId} in full (its sections, branch, pull requests and comments), so say only what to do with it now. A fact the task lacks goes on it as a comment, where the agent reads it with the rest. Do not restate its sections.` };
    }
    return contract.project && artifact.projectName ? { ...delegation, projectName: artifact.projectName } : delegation;
  }

  /** A project folder of the feature that left the workspaces root since it was linked is a place its agent cannot work in. */
  private async missingProjectFolders({ id, projectNames }: Artifact): Promise<string | undefined> {
    const folders = await this.workspacePort.listProjectFolders();
    const missing = projectNames.filter(name => !folders.includes(name));
    return missing.length > 0
      ? `${id} links ${missing.length === 1 ? 'a project folder' : 'project folders'} missing from the workspaces root: ${missing.join(', ')}. Correct its projects on the board before delegating it.`
      : undefined;
  }

  /**
   * A delegation to a role already working on the same artifact steers that agent, which receives only the new text and
   * not the artifact again, so a fact cannot move to a comment and the specification limit does not apply. One that
   * starts a new session for the task gives that session the artifact in full.
   */
  private redirects(conversationId: string, delegation: DelegationResult): boolean {
    return !startsNewTaskSession(delegation)
      && this.conversationRuntime.findActiveDelegation(conversationId, delegation.delegateToRole)?.artifactId === delegation.artifactId;
  }

  /**
   * A role already at work keeps its work unless the CEO says otherwise: only an instruction on the same work for an
   * agent known to take it mid-prompt goes in without `on_busy`, since anything else either waits or costs work. A new
   * session for the task cannot join the running prompt, so it needs `on_busy` as other work does.
   */
  private checkBusyRole(delegation: DelegationResult, conversationId: string): string | undefined {
    const active = this.conversationRuntime.findActiveDelegation(conversationId, delegation.delegateToRole);
    if (!active || delegation.onBusy) {
      return undefined;
    }
    const sameWork = active.projectName === (delegation.projectName ?? null) && active.artifactId === (delegation.artifactId ?? null);
    const steering = this.steeringSupport.supports(active.agentPort.agentName);
    const newSession = startsNewTaskSession(delegation);
    if (sameWork && !newSession && steering === true) {
      return undefined;
    }
    let reason: BusyRoleReason = 'other_work';
    if (sameWork && newSession) {
      reason = 'new_session';
    } else if (sameWork) {
      reason = steering === false ? 'no_steering' : 'unknown_steering';
    }
    let work = 'at the workspaces root';
    if (active.artifactId) {
      work = `on ${active.artifactId}`;
    } else if (active.projectName) {
      work = `in project folder "${active.projectName}"`;
    }
    return buildBusyRoleRepair(active.role, work, reason);
  }

  private async resolveDelegationFolder(
    delegation: DelegationResult,
    request: TurnRequest,
  ): Promise<ValidatedDelegation | { readonly reason: string }> {
    const { projectName } = delegation;

    if (!projectName) {
      return { ...delegation, cwd: request.workspacePath };
    }

    let cwd: string;
    try {
      cwd = this.workspacePort.resolveRepositoryPath(projectName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { reason: `Invalid project folder "${projectName}": ${message}. ${this.describeProjectFolders(await this.workspacePort.listProjectFolders())}` };
    }

    const folders = await this.workspacePort.listProjectFolders();
    if (!folders.includes(projectName)) {
      return {
        reason: `Project folder "${projectName}" does not exist in the workspaces root. ${this.describeProjectFolders(folders)}`,
      };
    }

    return { ...delegation, cwd };
  }

  /**
   * A conversation runs one agent per role, so a role appears once per response and a delegation to a role
   * already working replaces that agent. Agents of different roles that modify files would overwrite each
   * other's work in the same project folder, so each folder has one such agent: a task's agent occupies its project, a
   * feature's agent every project of the feature, and an agent without either the workspaces root.
   */
  private async findParallelConflict(delegations: readonly ValidatedDelegation[], conversationKey: string): Promise<string | undefined> {
    const roles = new Set<string>();
    const artifacts = new Set<string>();
    for (const { delegateToRole, artifactId } of delegations) {
      if (roles.has(delegateToRole)) {
        return `${delegateToRole} appears more than once. A conversation runs one agent per role: merge those tasks into a single delegation.`;
      }
      if (artifactId && artifacts.has(artifactId)) {
        return `${artifactId} appears in more than one delegation. An artifact is with one agent at a time: delegate it to one agent and the next one after its result.`;
      }
      roles.add(delegateToRole);
      if (artifactId) {
        artifacts.add(artifactId);
      }
    }

    const writers = new Map<string | null, string>();
    for (const active of this.conversationRuntime.getActiveDelegations(conversationKey)) {
      const redirected = delegations.some(delegation => delegation.delegateToRole === active.role.toUpperCase());
      if (!redirected && !this.isReadOnly(active.role)) {
        for (const folder of await this.occupiedFolders(conversationKey, active)) {
          writers.set(folder, `${active.role}, which is already working there`);
        }
      }
    }

    for (const delegation of delegations) {
      if (this.isReadOnly(delegation.delegateToRole)) {
        continue;
      }
      for (const folder of await this.occupiedFolders(conversationKey, delegation)) {
        const other = writers.get(folder);
        if (other) {
          return `${delegation.delegateToRole} cannot work in ${this.describeTarget(folder)} at the same time as ${other}: only one agent that modifies files may work in a folder at a time. Run them in sequence, or delegate to that same agent to redirect it.`;
        }
        writers.set(folder, delegation.delegateToRole);
      }
    }
    return undefined;
  }

  /** The project folders an agent works in, `null` for the workspaces root. A feature's are read from the board as it stands, which may differ from when its agent started. */
  private async occupiedFolders(
    conversationKey: string,
    { artifactId, projectName }: { readonly artifactId?: string | null; readonly projectName?: string | null },
  ): Promise<readonly (string | null)[]> {
    const artifact = artifactId ? await this.artifacts.get(conversationKey, artifactId) : undefined;
    return artifact?.type === 'feature' ? artifact.projectNames : [projectName ?? null];
  }

  private isReadOnly(role: string): boolean {
    return this.agentRegistry.getDelegationContract(role).readOnly === true;
  }

  private describeTarget(folder: string | null): string {
    return folder ? `project folder "${folder}"` : 'the workspaces root';
  }

  private describeProjectFolders(folders: readonly string[]): string {
    return folders.length > 0
      ? `Use one of the existing project folders exactly as written: ${folders.join(', ')}.`
      : 'The workspaces root has no project folders yet; add the repository first, delegating without a project folder.';
  }

  private checkDelegationContract(
    role: string,
    contract: DelegationContract,
    { projectName, sessionMode }: DelegationResult,
  ): string | undefined {
    if (projectName && !contract.project) {
      return `Role "${role}" does not take a project folder. Use <delegate role="${role}" summary="<summary>"> without the project attribute.`;
    }
    if (!projectName && contract.project === 'required') {
      return `Role "${role}" requires a project folder. Use <delegate role="${role}" summary="<summary>" project="<project-folder>">.`;
    }
    if (sessionMode && !contract.sessionMode) {
      return `Role "${role}" does not take a session mode. Use <delegate role="${role}" summary="<summary>"> without the session attribute.`;
    }
    return undefined;
  }
}
