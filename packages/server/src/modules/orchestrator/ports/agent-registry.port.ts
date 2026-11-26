import type { ArtifactSection, ArtifactStatus, RefinementKind } from '../../artifacts/models/artifact.model.js';
import type { AgentInterface } from '../models/agent-interface.model.js';


/** How a delegation of a role moves the status of the task it works on. */
export interface DelegationStatusFlow {
  /** The statuses a task may be in when it is delegated to the role. */
  readonly from: readonly ArtifactStatus[];
  /** The status the task takes when the agent starts. */
  readonly start?: ArtifactStatus;
  /** The status each verdict, the first word of the agent's final answer, leaves the task in. */
  readonly verdicts: Readonly<Record<string, ArtifactStatus>>;
}

export interface DelegationContract {
  readonly project?: 'required' | 'optional';
  /** The `session` attribute picks the session of a delegation without an artifact; with one, the task's session is used. */
  readonly sessionMode?: 'overridable';
  readonly readOnly?: true;
  /** Whether a delegation names the artifact the agent works on; absent, the agent takes none. */
  readonly artifact?: 'required' | 'optional';
  /** The delegated artifact must already have work to inspect: a linked pull request or a recorded branch. */
  readonly needsReviewableWork?: true;
  /** The agent asks the user directly; without it, a decision it needs comes back in its result. */
  readonly asksUser?: true;
  /** The CEO may delegate to the agent only in a turn that answers the user's message or answers, never on its own after an agent result. */
  readonly userInitiatedOnly?: true;
  /** The refinement the role settles on the artifacts it is delegated. */
  readonly refines?: RefinementKind;
  /** Absent, a delegation of the role leaves the status of its task alone. */
  readonly statusFlow?: DelegationStatusFlow;
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
  getSystemPrompt(agentRole: string, agentInterface: AgentInterface): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
  hasRole(agentRole: string): boolean;
  listRoles(): string[];
  /** The session of a delegation without an artifact and without the `session` attribute. */
  getDefaultSessionMode(agentRole: string): 'resume' | 'new';
  getDelegationContract(agentRole: string): DelegationContract;
  /** Read-only access to tasks for an unknown role. */
  getArtifactAccess(agentRole: string): ArtifactAccess;
  /** What the agent reads first in a prompt to a session it resumes, whose instructions may have been compacted away; empty for none. */
  getReentryNote(agentRole: string, agentInterface: AgentInterface): string;
  isSystemPromptEveryTurn(agentRole: string): boolean;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
