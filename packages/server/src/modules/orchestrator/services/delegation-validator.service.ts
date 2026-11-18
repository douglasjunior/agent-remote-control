import { Inject, Injectable } from '@nestjs/common';

import { CLOSED_ARTIFACT_STATUSES, FROZEN_STATUS } from '../../artifacts/constants/artifact-catalog.constant.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { ValidatedDecision, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { type DelegationContract, IAgentRegistryPort } from '../ports/agent-registry.port.js';

import { ConversationRuntimeService } from './conversation-runtime.service.js';
import { type DelegationResult, DelegationDetectorService } from './delegation-detector.service.js';


/** Checks the delegations of a CEO response against the team, the board, the workspace and the agents already running. */
@Injectable()
export class DelegationValidatorService {
  constructor(
    private readonly delegationDetector: DelegationDetectorService,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    @Inject(IWorkspacePort) private readonly workspacePort: IWorkspacePort,
    private readonly conversationRuntime: ConversationRuntimeService,
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

    const conflict = this.findParallelConflict(delegations, request.conversationId);
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
    const violation = this.checkDelegationContract(delegateToRole, contract, withArtifact);
    if (violation) {
      return { reason: violation };
    }
    return this.resolveDelegationFolder(withArtifact, request);
  }

  /**
   * A delegation names the artifact its agent works on and then runs in that artifact's project: the folder may be
   * left out, and a different one is a mistake. The artifact must be open, of a type the agent works on, ready for
   * it and with no agent of another role holding it, because an artifact is with one agent at a time.
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
    if (contract.needsReviewableWork && artifact.pullRequests.length === 0 && !artifact.branch) {
      return { reason: `${role} inspects the work of ${artifactId}, which has neither a pull request nor a branch yet. Record the branch of its implementation first.` };
    }
    if (artifact.assignee && artifact.assignee.role !== role) {
      return { reason: `${artifactId} is with ${artifact.assignee.role} right now, and an artifact is with one agent at a time. Wait for its result, or redirect that agent.` };
    }
    if (projectName && projectName !== artifact.projectName) {
      return { reason: `${artifactId} belongs to project "${artifact.projectName}", so the work on it runs there: use project="${artifact.projectName}" or leave the project out.` };
    }
    return contract.project ? { ...delegation, projectName: artifact.projectName } : delegation;
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
   * other's work in the same folder.
   */
  private findParallelConflict(delegations: readonly ValidatedDelegation[], conversationKey: string): string | undefined {
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

    const writers = new Map<string, string>();
    for (const active of this.conversationRuntime.getActiveDelegations(conversationKey)) {
      const redirected = delegations.some(delegation => delegation.delegateToRole === active.role.toUpperCase());
      if (!redirected && !this.isReadOnly(active.role)) {
        writers.set(active.cwd, `${active.role}, which is already working there`);
      }
    }

    for (const { delegateToRole, projectName, cwd } of delegations) {
      if (this.isReadOnly(delegateToRole)) {
        continue;
      }
      const other = writers.get(cwd);
      if (other) {
        return `${delegateToRole} cannot work in ${this.describeTarget(projectName)} at the same time as ${other}: only one agent that modifies files may work in a folder at a time. Run them in sequence, or delegate to that same agent to redirect it.`;
      }
      writers.set(cwd, delegateToRole);
    }
    return undefined;
  }

  private isReadOnly(role: string): boolean {
    return this.agentRegistry.getDelegationContract(role).readOnly === true;
  }

  private describeTarget(projectName: string | undefined): string {
    return projectName ? `project folder "${projectName}"` : 'the workspaces root';
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
