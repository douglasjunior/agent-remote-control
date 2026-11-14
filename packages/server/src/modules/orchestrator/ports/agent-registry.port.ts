import type { ArtifactSection } from '../../artifacts/models/artifact.model.js';


export interface DelegationContract {
  readonly project?: 'required' | 'optional';
  readonly sessionMode?: 'overridable';
  readonly readOnly?: true;
  /** Whether a delegation names the artifact the agent works on; absent, the agent takes none. */
  readonly artifact?: 'required' | 'optional';
  /** The delegated artifact must already have work to inspect: a linked pull request or a recorded branch. */
  readonly needsReviewableWork?: true;
}

/** The artifact fields besides the sections; `pull_requests` adds or updates the links of the artifact. */
export type ArtifactField = 'title' | 'parent' | 'project' | 'depends_on' | 'status' | 'refinement' | 'branch' | 'pull_requests';

/**
 * What a role may do with the artifacts through its responses:
 * - `board`: reads any artifact, one at a time, and lists them all (the agent that coordinates the work);
 * - `tree`: reads any artifact, a feature with all its tasks, and writes any artifact no other agent holds;
 * - `task`: reads tasks only and writes only the task it was delegated.
 */
export interface ArtifactAccess {
  readonly scope: 'board' | 'tree' | 'task';
  readonly create?: true;
  readonly sections: readonly ArtifactSection[];
  readonly fields: readonly ArtifactField[];
}

export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
  hasRole(agentRole: string): boolean;
  listRoles(): string[];
  getDefaultSessionMode(agentRole: string): 'resume' | 'new';
  getDelegationContract(agentRole: string): DelegationContract;
  /** Read-only access to tasks for an unknown role. */
  getArtifactAccess(agentRole: string): ArtifactAccess;
  getTurnReminder(agentRole: string): string;
  isSystemPromptEveryTurn(agentRole: string): boolean;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
