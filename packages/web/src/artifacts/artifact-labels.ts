import type { ArtifactSection, ArtifactStatus, ArtifactType, RefinementKind, RefinementState } from '@agent-remote-control/protocol/artifact';


export const TYPE_LABELS: Readonly<Record<ArtifactType, string>> = {
  feature: 'Feature',
  task: 'Task',
};

export const STATUS_LABELS: Readonly<Record<ArtifactStatus, string>> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  in_testing: 'In testing',
  tested: 'Tested',
  done: 'Done',
  blocked: 'Blocked',
  frozen: 'Frozen',
  cancelled: 'Cancelled',
};

/** The color each status is drawn with, from the theme tokens the agents already use. */
export const STATUS_TONES: Readonly<Record<ArtifactStatus, string>> = {
  backlog: 'var(--muted-foreground)',
  ready: 'var(--agent-tech-lead)',
  in_progress: 'var(--agent-developer)',
  in_review: 'var(--agent-code-reviewer)',
  changes_requested: 'var(--attention)',
  approved: 'var(--good)',
  in_testing: 'var(--agent-qa)',
  tested: 'var(--good)',
  done: 'var(--good)',
  blocked: 'var(--destructive)',
  frozen: 'var(--frozen)',
  cancelled: 'var(--muted-foreground)',
};

/** Where the user can send a frozen task back to: every open status. */
export const UNFREEZE_STATUSES: readonly ArtifactStatus[] = ['backlog', 'ready', 'in_progress', 'in_review', 'changes_requested', 'approved', 'in_testing', 'tested', 'blocked'];

export const SECTION_LABELS: Readonly<Record<ArtifactSection, string>> = {
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

export const REFINEMENT_KIND_LABELS: Readonly<Record<RefinementKind, string>> = {
  business: 'Business',
  design: 'Design',
  technical: 'Technical',
};

export const REFINEMENT_LABELS: Readonly<Record<RefinementState, string>> = {
  pending: 'Pending',
  done: 'Done',
  skipped: 'Not needed',
};
