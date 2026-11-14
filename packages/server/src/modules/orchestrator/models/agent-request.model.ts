import type {
  ArtifactRefinement,
  ArtifactStatus,
  ArtifactType,
  PullRequestInput,
  SectionChange,
} from '../../artifacts/models/artifact.model.js';


/**
 * What an agent asked the orchestrator for in one response: reading or changing the board, or reading and writing skills. A `parent` or `dependsOn` value is an artifact id or the
 * `ref` of an artifact created earlier in the same response; `null` clears it.
 */
export type AgentRequest =
  | {
    readonly kind: 'list';
    readonly types?: readonly ArtifactType[];
    readonly statuses?: readonly ArtifactStatus[] | 'all';
    readonly parent?: string | null;
    readonly project?: string;
  }
  | { readonly kind: 'read'; readonly ids: readonly string[]; readonly tree: boolean }
  | {
    readonly kind: 'create';
    readonly ref?: string;
    readonly type: ArtifactType;
    readonly title: string;
    readonly parent?: string | null;
    readonly project?: string;
    readonly dependsOn?: readonly string[];
    readonly refinement?: Partial<ArtifactRefinement>;
    readonly sections: readonly SectionChange[];
  }
  | {
    readonly kind: 'update';
    readonly id: string;
    readonly title?: string;
    readonly status?: ArtifactStatus;
    readonly parent?: string | null;
    readonly project?: string;
    readonly dependsOn?: readonly string[];
    readonly refinement?: Partial<ArtifactRefinement>;
    readonly branch?: string | null;
    readonly note?: string;
    readonly sections: readonly SectionChange[];
    readonly pullRequests: readonly PullRequestInput[];
  }
  | { readonly kind: 'comment'; readonly id: string; readonly text: string }
  | { readonly kind: 'skill_read'; readonly names: readonly string[] }
  | { readonly kind: 'skill_list' }
  | {
    readonly kind: 'skill_write';
    readonly name: string;
    readonly description: string;
    readonly roles: readonly string[];
    readonly content: string;
  }
  /** A tag that could not be read; its reason goes back to the agent among the results. */
  | { readonly kind: 'invalid'; readonly tag: string; readonly reason: string };

/** The agent whose response carried the requests, with the delegation and artifact it works on, if any. */
export type AgentRequester = {
  readonly role: string;
  readonly roleName: string;
  readonly conversationId: string;
  readonly delegationId?: string;
  readonly artifactId?: string;
};
