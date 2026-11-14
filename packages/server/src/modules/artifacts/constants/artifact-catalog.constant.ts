export const ARTIFACT_TYPES = ['feature', 'task'] as const;

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

/** The status the server sets on a task that went through too many delegations; only the user takes a task out of it. */
export const FROZEN_STATUS = 'frozen';

/** Statuses that take an artifact off the board: nobody works on it any more. */
export const CLOSED_ARTIFACT_STATUSES: readonly string[] = ['done', 'cancelled'];

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
  technical_solution: 'Technical solution',
  implementation_notes: 'Implementation notes',
  review_findings: 'Review findings',
  test_report: 'Test report',
};

export const REFINEMENT_STATES = ['pending', 'done', 'skipped'] as const;

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
