import type { ArtifactAccess } from '../../orchestrator/ports/agent-registry.port.js';


/** Coordinates the board: creates the work a request needs, moves statuses and refinements, and writes only the request it received. */
export const CEO_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'board',
  create: true,
  sections: ['overview'],
  fields: ['title', 'parent', 'project', 'depends_on', 'status', 'refinement'],
};

/** Owns the business content of the board: features, tasks and every section about what to build and why. */
export const PRODUCT_OWNER_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'tree',
  create: true,
  sections: [
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
  ],
  fields: ['title', 'parent', 'project', 'depends_on', 'refinement'],
};

/** Owns the technical solution and the technical breakdown into tasks, and complements the sections that verify the work. */
export const TECH_LEAD_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'tree',
  create: true,
  sections: ['technical_solution', 'test_cases', 'acceptance_criteria', 'flows', 'glossary', 'pending_decisions', 'open_questions'],
  fields: ['title', 'parent', 'project', 'depends_on', 'refinement'],
};

export const DEVELOPER_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'task',
  sections: ['implementation_notes'],
  fields: ['branch'],
};

export const GIT_OPS_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'task',
  sections: [],
  fields: ['branch', 'pull_requests'],
};

export const CODE_REVIEWER_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'task',
  sections: ['review_findings'],
  fields: [],
};

export const QA_ARTIFACT_ACCESS: ArtifactAccess = {
  scope: 'task',
  sections: ['test_report'],
  fields: [],
};
