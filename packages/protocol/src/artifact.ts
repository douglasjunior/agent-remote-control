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
  'done',
  'blocked',
  'frozen',
  'cancelled',
] as const;
export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

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
  'technical_solution',
  'implementation_notes',
  'review_findings',
  'test_report',
] as const;
export const artifactSectionSchema = z.enum(ARTIFACT_SECTIONS);
export type ArtifactSection = z.infer<typeof artifactSectionSchema>;

/** Whether the business (Product Owner) or technical (Tech Lead) refinement of an artifact is still owed. */
export const refinementStateSchema = z.enum(['pending', 'done', 'skipped']);
export type RefinementState = z.infer<typeof refinementStateSchema>;

export const pullRequestStateSchema = z.enum(['open', 'merged', 'closed']);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

export const artifactRefinementSchema = z.object({
  business: refinementStateSchema,
  technical: refinementStateSchema,
});
export type ArtifactRefinement = z.infer<typeof artifactRefinementSchema>;

/** The agent holding the artifact; an artifact is with one agent at a time. */
export const artifactAssigneeSchema = z.object({
  role: z.string(),
  roleName: z.string(),
  delegationId: z.string(),
  since: z.iso.datetime(),
});
export type ArtifactAssignee = z.infer<typeof artifactAssigneeSchema>;

export const pullRequestLinkSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
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
  /** The project folder of the workspace root the artifact belongs to; a task under a feature always has the feature's. */
  projectName: z.string(),
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
  /** Required without a parent; a task under a feature has the feature's and may leave it out. */
  projectName: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  sections: sectionsInputSchema.optional(),
  /** Whether the Product Owner must refine the business side before the work moves on. */
  businessRefinement: z.boolean(),
  /** Whether the Tech Lead must refine the technical side before the work moves on. */
  technicalRefinement: z.boolean(),
});
export type ArtifactCreateInput = z.infer<typeof artifactCreateInputSchema>;

export const artifactUpdateInputSchema = z.object({
  title: titleSchema.optional(),
  status: artifactStatusSchema.optional(),
  parentId: z.string().nullable().optional(),
  projectName: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  sections: sectionsInputSchema.optional(),
  refinement: artifactRefinementSchema.partial().optional(),
  branch: z.string().nullable().optional(),
});
export type ArtifactUpdateInput = z.infer<typeof artifactUpdateInputSchema>;

export const artifactCommentSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);
