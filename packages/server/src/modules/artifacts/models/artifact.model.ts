import type {
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  PULL_REQUEST_STATES,
  REFINEMENT_STATES,
} from '../constants/artifact-catalog.constant.js';


export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export type ArtifactSection = (typeof ARTIFACT_SECTIONS)[number];
export type RefinementState = (typeof REFINEMENT_STATES)[number];
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** Whether the business (Product Owner) and technical (Tech Lead) refinements are still owed. */
export type ArtifactRefinement = {
  readonly business: RefinementState;
  readonly technical: RefinementState;
};

/** The agent holding the artifact while its delegation runs; an artifact is with one agent at a time. */
export type ArtifactAssignee = {
  readonly role: string;
  readonly roleName: string;
  readonly delegationId: string;
  readonly since: string;
};

export type PullRequestLink = {
  readonly url: string;
  readonly title?: string;
  readonly state: PullRequestState;
  readonly addedAt: string;
};

/** Who changed an artifact: an agent of its conversation, a person through a channel, or the server itself. */
export type ArtifactActor =
  | { readonly kind: 'agent'; readonly role: string; readonly roleName: string }
  | { readonly kind: 'user'; readonly channel: string }
  | { readonly kind: 'system' };

/** `field` is an artifact field or `section:<name>`; a section change says how it changed in `to`. */
export type ArtifactFieldChange = {
  readonly field: string;
  readonly from?: string;
  readonly to?: string;
};

export type ArtifactHistoryKind = 'created' | 'updated' | 'commented' | 'assigned' | 'released';

export type ArtifactHistoryEvent = {
  readonly id: string;
  readonly at: string;
  readonly actor: ArtifactActor;
  readonly kind: ArtifactHistoryKind;
  readonly summary: string;
  readonly changes?: readonly ArtifactFieldChange[];
  readonly text?: string;
};

export type ArtifactSections = Partial<Readonly<Record<ArtifactSection, string>>>;

export type Artifact = {
  readonly id: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly status: ArtifactStatus;
  readonly parentId: string | null;
  /** The project folder of the workspace root; a task under a feature always has the feature's. */
  readonly projectName: string;
  readonly dependsOn: readonly string[];
  readonly refinement: ArtifactRefinement;
  readonly assignee: ArtifactAssignee | null;
  readonly branch: string | null;
  readonly pullRequests: readonly PullRequestLink[];
  readonly sections: ArtifactSections;
  readonly history: readonly ArtifactHistoryEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ArtifactFilter = {
  readonly types?: readonly ArtifactType[];
  /** Without statuses, the artifacts still open: neither done nor cancelled. */
  readonly statuses?: readonly ArtifactStatus[] | 'all';
  /** Direct children of this artifact; `null` lists only the roots. */
  readonly parentId?: string | null;
  readonly projectName?: string;
};

export type CreateArtifactInput = {
  readonly type: ArtifactType;
  readonly title: string;
  readonly parentId?: string | null;
  /** Required without a parent; a task under a feature has the feature's and may leave it out. */
  readonly projectName?: string;
  readonly dependsOn?: readonly string[];
  readonly sections?: ArtifactSections;
  /** Each refinement left out is owed (`pending`). */
  readonly refinement?: Partial<ArtifactRefinement>;
};

export type SectionChange = {
  readonly section: ArtifactSection;
  readonly content: string;
  /** `append` adds the content after a blank line; `replace` sets it, and empty content clears the section. */
  readonly mode: 'replace' | 'append';
};

export type PullRequestInput = {
  readonly url: string;
  readonly title?: string;
  readonly state?: PullRequestState;
};

export type ArtifactChanges = {
  readonly title?: string;
  readonly status?: ArtifactStatus;
  readonly parentId?: string | null;
  /** Only an artifact without children moves to another project. */
  readonly projectName?: string;
  readonly dependsOn?: readonly string[];
  readonly sections?: readonly SectionChange[];
  readonly refinement?: Partial<ArtifactRefinement>;
  readonly branch?: string | null;
  /** Added, or updated when a link with the same URL exists. */
  readonly pullRequests?: readonly PullRequestInput[];
  /** Why the change was made, kept in the history. */
  readonly note?: string;
};

export type ArtifactOutcome =
  | { readonly ok: true; readonly artifact: Artifact }
  | { readonly ok: false; readonly error: string };

export type ArtifactRemoval =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** What happened to the artifacts of a conversation, for whoever follows them (a channel keeping a board up to date). */
export type ArtifactChangeEvent =
  | { readonly kind: 'saved'; readonly conversationId: string; readonly artifact: Artifact }
  | { readonly kind: 'deleted'; readonly conversationId: string; readonly id: string };
