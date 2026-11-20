export const ARTIFACT_TYPES = ['feature', 'task'] as const;

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

/** The status the server sets on a task that went through too many delegations; only the user takes a task out of it. */
export const FROZEN_STATUS = 'frozen';

/** Statuses that take an artifact off the board: nobody works on it any more. */
export const CLOSED_ARTIFACT_STATUSES: readonly string[] = ['done', 'cancelled'];

/** Statuses of a task somebody is working on, which keep its feature moving. */
export const ACTIVE_TASK_STATUSES: readonly string[] = ['in_progress', 'in_review', 'changes_requested', 'approved', 'in_testing', 'tested'];

/** Statuses that end the work on an artifact: a user who moves a held artifact to one of them stops the agent holding it. */
export const WORK_ENDING_STATUSES: readonly string[] = ['done', 'blocked', 'cancelled'];

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

export const ARTIFACT_SECTION_TITLES: Readonly<Record<(typeof ARTIFACT_SECTIONS)[number], string>> = {
  overview: 'Overview',
  user_stories: 'User stories',
  scope: 'Scope',
  business_rules: 'Business rules',
  flows: 'Flows and edge cases',
  acceptance_criteria: 'Acceptance criteria',
  test_cases: 'Test cases',
  glossary: 'Glossary',
  pending_decisions: 'Pending decisions',
  open_questions: 'Open questions',
  ux_design: 'UX design',
  technical_solution: 'Technical solution',
  implementation_notes: 'Implementation notes',
  review_findings: 'Review findings',
  test_report: 'Test report',
};

/** The refinements an artifact may owe, in the order the work goes through them: what to build, how it looks, how to build it. */
export const REFINEMENT_KINDS = ['business', 'design', 'technical'] as const;

export const REFINEMENT_STATES = ['pending', 'done', 'skipped'] as const;

/**
 * The state of a kind an artifact has no stored state for. A kind added after the artifact was stored was never owed
 * by it, so `design` reads as skipped; the others are owed.
 */
export const UNSTORED_REFINEMENT_STATES: Readonly<Record<(typeof REFINEMENT_KINDS)[number], (typeof REFINEMENT_STATES)[number]>> = {
  business: 'pending',
  design: 'skipped',
  technical: 'pending',
};

export const PULL_REQUEST_STATES = ['open', 'merged', 'closed'] as const;

export const ARTIFACT_ID_PREFIXES: Readonly<Record<(typeof ARTIFACT_TYPES)[number], string>> = {
  feature: 'F',
  task: 'T',
};

/** The types an artifact of each type may sit under: a feature is always a root and a task never has children. */
export const ARTIFACT_PARENT_TYPES: Readonly<Record<(typeof ARTIFACT_TYPES)[number], readonly string[]>> = {
  feature: [],
  task: ['feature'],
};
