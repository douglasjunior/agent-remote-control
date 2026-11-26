import type {
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  PULL_REQUEST_STATES,
  REFINEMENT_KINDS,
  REFINEMENT_STATES,
} from '../constants/artifact-catalog.constant.js';


export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export type ArtifactSection = (typeof ARTIFACT_SECTIONS)[number];
export type RefinementKind = (typeof REFINEMENT_KINDS)[number];
export type RefinementState = (typeof REFINEMENT_STATES)[number];
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** Whether each refinement is still owed. */
export type ArtifactRefinement = Readonly<Record<RefinementKind, RefinementState>>;

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
  /** Path of the git repository inside the task's project folder: `.` for the folder itself, `repositories/api` for a nested clone. */
  readonly repository: string;
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
  /** The one project folder of the workspace root a task works in, always one of its feature's `projectNames`; `null` for a feature. */
  readonly projectName: string | null;
  /** The project folders a feature links (at least one), or a task's own project as a one-item list. */
  readonly projectNames: readonly string[];
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
  /** A feature matches when it links the project, a task when it works in it. */
  readonly projectName?: string;
};

export type CreateArtifactInput = {
  readonly type: ArtifactType;
  readonly title: string;
  readonly parentId?: string | null;
  /** The project of a task; a task under a feature may leave it out only when the feature has a single project. */
  readonly projectName?: string;
  /** The projects of a feature, at least one; `projectName` alone stands for a single one. */
  readonly projectNames?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly sections?: ArtifactSections;
  /** Each refinement left out takes its `DEFAULT_REFINEMENT_STATES` entry. */
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
  /** Left out, it keeps the stored one, or `DEFAULT_PULL_REQUEST_REPOSITORY` for a new link. */
  readonly repository?: string;
  readonly state?: PullRequestState;
};

export type ArtifactChanges = {
  readonly title?: string;
  readonly status?: ArtifactStatus;
  readonly parentId?: string | null;
  /** Moves a task to another project, which stays one of its feature's. */
  readonly projectName?: string;
  /** Replaces the projects of a feature; a project still used by its tasks stays. */
  readonly projectNames?: readonly string[];
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
