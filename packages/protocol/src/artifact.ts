import { z } from 'zod';

import { MAX_ARTIFACT_SECTION_LENGTH, MAX_ARTIFACT_TITLE_LENGTH, MAX_MESSAGE_LENGTH } from './limits.js';


/** A feature groups the tasks of one mission; a task is the unit an agent works on, inside a feature or on its own. */
export const ARTIFACT_TYPES = ['feature', 'task'] as const;
export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const ARTIFACT_STATUSES = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'changes_requested',
  'approved',
  'in_testing',
  'tested',
  'done',
  'blocked',
  'frozen',
  'cancelled',
] as const;
export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

/** Statuses that end the work on an artifact: moving a held artifact to one of them stops the agent holding it. */
export const WORK_ENDING_STATUSES: readonly ArtifactStatus[] = ['done', 'blocked', 'cancelled'];

export const ARTIFACT_SECTIONS = [
  'overview',
  'user_stories',
  'scope',
  'business_rules',
  'flows',
  'acceptance_criteria',
  'test_cases',
  'glossary',
  'pending_decisions',
  'open_questions',
  'ux_design',
  'technical_solution',
  'implementation_notes',
  'review_findings',
  'test_report',
] as const;
export const artifactSectionSchema = z.enum(ARTIFACT_SECTIONS);
export type ArtifactSection = z.infer<typeof artifactSectionSchema>;

/** The refinements an artifact may owe before its work moves on, each settled by the agent whose role refines it. */
export const REFINEMENT_KINDS = ['business', 'design', 'technical'] as const;
export const refinementKindSchema = z.enum(REFINEMENT_KINDS);
export type RefinementKind = z.infer<typeof refinementKindSchema>;

export const refinementStateSchema = z.enum(['pending', 'done', 'skipped']);
export type RefinementState = z.infer<typeof refinementStateSchema>;

export const pullRequestStateSchema = z.enum(['open', 'merged', 'closed']);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

export const artifactRefinementSchema = z.record(refinementKindSchema, refinementStateSchema);
export type ArtifactRefinement = z.infer<typeof artifactRefinementSchema>;

/** The agent holding the artifact; an artifact is with one agent at a time. */
export const artifactAssigneeSchema = z.object({
  role: z.string(),
  roleName: z.string(),
  delegationId: z.string(),
  since: z.iso.datetime(),
});
export type ArtifactAssignee = z.infer<typeof artifactAssigneeSchema>;

/** The repository a pull request belongs to, relative to the project folder of its task; `.` is the project folder itself. */
export const DEFAULT_PULL_REQUEST_REPOSITORY = '.';

export const pullRequestLinkSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  /** Path of the git repository inside the task's project folder: `.` for the folder itself, `repositories/api` for a nested clone. */
  repository: z.string().default(DEFAULT_PULL_REQUEST_REPOSITORY),
  state: pullRequestStateSchema,
  addedAt: z.iso.datetime(),
});
export type PullRequestLink = z.infer<typeof pullRequestLinkSchema>;

export const artifactActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), role: z.string(), roleName: z.string() }),
  z.object({ kind: z.literal('user'), channel: z.string() }),
  z.object({ kind: z.literal('system') }),
]);
export type ArtifactActor = z.infer<typeof artifactActorSchema>;

/** `field` is an artifact field or `section:<name>`; a section change carries how it changed in `to`. */
export const artifactFieldChangeSchema = z.object({
  field: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ArtifactFieldChange = z.infer<typeof artifactFieldChangeSchema>;

export const artifactHistoryEventSchema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  actor: artifactActorSchema,
  kind: z.enum(['created', 'updated', 'commented', 'assigned', 'released']),
  summary: z.string(),
  changes: z.array(artifactFieldChangeSchema).optional(),
  /** The comment of a `commented` event. */
  text: z.string().optional(),
});
export type ArtifactHistoryEvent = z.infer<typeof artifactHistoryEventSchema>;

export const artifactSummarySchema = z.object({
  id: z.string(),
  type: artifactTypeSchema,
  title: z.string(),
  status: artifactStatusSchema,
  parentId: z.string().nullable(),
  /** The one project folder of the workspace root a task works in, always one of its feature's `projectNames`; `null` for a feature. */
  projectName: z.string().nullable(),
  /** The project folders of the workspace root: the at least one a feature links, or a task's own project as a one-item list, so a consumer reads one field. */
  projectNames: z.array(z.string()).min(1),
  /** Siblings only: other features for a feature, other tasks of the same feature for a task (or other standalone tasks). */
  dependsOn: z.array(z.string()),
  refinement: artifactRefinementSchema,
  assignee: artifactAssigneeSchema.nullable(),
  branch: z.string().nullable(),
  pullRequests: z.array(pullRequestLinkSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

export const artifactSectionsSchema = z.partialRecord(artifactSectionSchema, z.string());
export type ArtifactSections = z.infer<typeof artifactSectionsSchema>;

export const artifactDetailSchema = artifactSummarySchema.extend({
  sections: artifactSectionsSchema,
  history: z.array(artifactHistoryEventSchema),
});
export type ArtifactDetail = z.infer<typeof artifactDetailSchema>;

const titleSchema = z.string().trim().min(1).max(MAX_ARTIFACT_TITLE_LENGTH);
const sectionsInputSchema = z.partialRecord(artifactSectionSchema, z.string().max(MAX_ARTIFACT_SECTION_LENGTH));

export const artifactCreateInputSchema = z.object({
  type: artifactTypeSchema,
  title: titleSchema,
  parentId: z.string().nullable().optional(),
  /** The project of a task; a task under a feature may leave it out only when the feature has a single project. */
  projectName: z.string().optional(),
  /** The projects of a feature, at least one. */
  projectNames: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  sections: sectionsInputSchema.optional(),
  /** The refinements owed before the work moves on; a kind left out is not needed. */
  refinements: z.partialRecord(refinementKindSchema, z.boolean()),
});
export type ArtifactCreateInput = z.infer<typeof artifactCreateInputSchema>;

export const artifactUpdateInputSchema = z.object({
  title: titleSchema.optional(),
  status: artifactStatusSchema.optional(),
  parentId: z.string().nullable().optional(),
  /** Moves a task to another project of its feature. */
  projectName: z.string().optional(),
  /** Replaces the projects of a feature; one still used by its tasks cannot be left out. */
  projectNames: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  sections: sectionsInputSchema.optional(),
  refinement: z.partialRecord(refinementKindSchema, refinementStateSchema).optional(),
  branch: z.string().nullable().optional(),
});
export type ArtifactUpdateInput = z.infer<typeof artifactUpdateInputSchema>;

export const artifactCommentSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);
