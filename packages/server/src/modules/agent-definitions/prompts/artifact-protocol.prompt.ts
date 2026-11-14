import {
  ARTIFACT_SECTION_TITLES,
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  FROZEN_STATUS,
  REFINEMENT_STATES,
} from '../../artifacts/constants/artifact-catalog.constant.js';
import type { ArtifactAccess, ArtifactField } from '../../orchestrator/ports/agent-registry.port.js';


const FIELD_ATTRIBUTES: Readonly<Record<ArtifactField, string>> = {
  title: 'title="..."',
  parent: 'parent="F-1" (or "none")',
  project: 'project="<project-folder>"',
  depends_on: 'depends_on="T-1,T-2" (or "none")',
  status: `status="${ARTIFACT_STATUSES.filter(status => status !== FROZEN_STATUS).join('|')}" (\`frozen\` is set by the server on a task that went through too many delegations, and only the user takes a task out of it)`,
  refinement: `business_refinement="${REFINEMENT_STATES.join('|')}" and technical_refinement="${REFINEMENT_STATES.join('|')}"`,
  branch: 'branch="<branch name>" (or "none")',
  pull_requests: '<pull_request url="https://..." title="..." state="open|merged|closed"/> inside the tag, one per pull request',
};

/** The skill that holds this grammar for every executor role, to read again when the system prompt is out of view. */
export const BOARD_REQUESTS_SKILL_NAME = 'board-requests';

/**
 * The board and its request grammar, written for one role from what it may do. Requests go inside the final
 * response; the backend answers them with `<request_results>` in the agent's next prompt.
 */
export function buildArtifactProtocolInstructions(access: ArtifactAccess): string {
  return `### The Board
The work of this conversation lives on a board of artifacts. A feature groups the tasks of one initiative; a task is the unit one agent works on, inside a feature or on its own. Every artifact belongs to one project folder of the workspace root, and a task inside a feature always belongs to the feature's: work that spans several repositories is one feature per project, with dependencies between the features. Every artifact has an id such as \`F-1\` or \`T-3\`, a status (${ARTIFACT_STATUSES.join(', ')}), the business and technical refinement states (${REFINEMENT_STATES.join(', ')}), dependencies on its siblings (a feature on other features, a task on the other tasks of its feature, a standalone task on other standalone tasks), a branch, pull requests, comments, and content split in sections:
${ARTIFACT_SECTIONS.map(section => `- \`${section}\`: ${ARTIFACT_SECTION_TITLES[section]}`).join('\n')}

You read and change the board with requests written inside your final response. The orchestrator carries them out in order, before anything else in the response, and answers with an \`<request_results>\` block, one \`<request_result>\` per request with \`status="ok"\` or \`status="error"\` and the reason. When the response also ${access.scope === 'board' ? 'delegates or asks the user questions' : 'asks the user questions'}, it goes on as usual and the results open your next prompt. Otherwise the results come back right away and the response is not taken as your final answer: give your final answer in a later response without requests. Write the tags as plain text, never inside code fences.

${buildRequests(access)}

${buildRules(access)}`;
}

/**
 * The board in brief, for the system prompt of an executor: what it holds, the requests the role uses in most tasks,
 * what it may write, and the skill with the full grammar for anything else.
 */
export function buildArtifactProtocolBrief(access: ArtifactAccess): string {
  const writes = access.sections.length > 0 || access.fields.length > 0;
  const updateExample = [
    access.fields.includes('branch') ? ' branch="feat/t-1-login"' : '',
    access.fields.includes('status') ? ' status="in_progress"' : '',
  ].join('');
  const updateChildren = [
    ...(access.sections.length > 0 ? [`<section name="${access.sections[0]}">Markdown</section>`] : []),
    ...(access.fields.includes('pull_requests') ? ['<pull_request url="https://..." state="open"/>'] : []),
  ].join('');
  const lines = [
    '### The Board',
    'The work of this conversation lives on a board of artifacts: features grouping the tasks of one initiative, and tasks, the unit one agent works on. Each has an id (`F-1`, `T-3`), a status, a branch, pull requests, comments, and its content in Markdown sections. You read and change it with requests written as plain text inside your final response; the orchestrator carries them out before anything else and answers with `<request_results>` in your next prompt. A response with nothing but requests is not your final answer: give it in a later response without them.',
    `- \`<artifact_read id="T-1"/>\` reads the full content of ${access.scope === 'task' ? 'tasks' : 'artifacts'}.`,
    ...(writes ? [`- \`<artifact_update id="T-1"${updateExample}>${updateChildren}</artifact_update>\` changes an artifact.`] : []),
    ...(access.create ? ['- `<artifact_create type="task" title="..." project="my-app"><section name="overview">Markdown</section></artifact_create>` creates one.'] : []),
    '- `<artifact_comment id="T-1">text</artifact_comment>` comments on one.',
    access.sections.length > 0
      ? `- Sections you write: ${access.sections.map(section => `\`${section}\``).join(', ')}.${access.fields.length > 0 ? ` Fields you change: ${access.fields.join(', ')}.` : ''}`
      : `- You write no section${access.fields.length > 0 ? `; fields you change: ${access.fields.join(', ')}` : ''}. Record what the next agent must know as a comment.`,
    access.scope === 'task'
      ? '- You read tasks only and change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block.'
      : '- An artifact another agent holds is not changed under you; comment on it instead.',
    `- Every other request and attribute (listing, dependencies, statuses, refinements, creating several artifacts at once) is in the \`${BOARD_REQUESTS_SKILL_NAME}\` skill, written for your role: read it before a request you are not sure of.`,
  ];
  return lines.join('\n');
}

export function buildArtifactProtocolReminder(access: ArtifactAccess): string {
  const scope = access.scope === 'task'
    ? 'You read tasks and change only the task you were delegated.'
    : 'An artifact another agent holds is not changed under you; comment on it instead.';
  return `- Read and change the board only with artifact requests; a response with nothing but requests gets their results right away, and your final answer comes in a response without them. ${scope} When the request grammar is no longer in front of you, read the \`${BOARD_REQUESTS_SKILL_NAME}\` skill before writing a request.`;
}

function buildRequests(access: ArtifactAccess): string {
  const lines = [
    '#### Requests',
    access.scope === 'task'
      ? '- `<artifact_list status="ready,in_progress"/>` lists the tasks of the board, one line each. Without `status` it lists the open ones (neither done nor cancelled); `status="all"` lists every one.'
      : '- `<artifact_list type="feature" status="ready,in_progress" parent="F-1" project="my-app"/>` lists artifacts, one line each; every attribute is optional. Without `status` it lists the open ones (neither done nor cancelled); `status="all"` lists every one; `parent="none"` lists the features and the tasks outside any feature.',
    access.scope === 'task'
      ? '- `<artifact_read id="T-1,T-2"/>` reads the full content of tasks, such as the tasks yours depends on.'
      : '- `<artifact_read id="T-1,F-2"/>` reads the full content of artifacts; a feature comes with the list of its tasks.',
    ...(access.scope === 'tree' ? ['- `<artifact_read id="F-1" tree="true"/>` reads a feature with the full content of every task under it.'] : []),
    ...(access.create ? [buildCreateRequest(access)] : []),
    ...(access.sections.length > 0 || access.fields.length > 0 ? [buildUpdateRequest(access)] : []),
    '- `<artifact_comment id="T-1">text</artifact_comment>` adds a comment to the artifact, kept in its history and shown to whoever reads it.',
  ];
  return lines.join('\n');
}

function buildCreateRequest(access: ArtifactAccess): string {
  const refinement = access.fields.includes('refinement')
    ? ` business_refinement="pending" technical_refinement="pending"`
    : '';
  return `- Create an artifact, with the sections you write as children:
  \`\`\`text
  <artifact_create type="task" title="Short title" project="my-app" parent="F-1" depends_on="T-1" ref="login-api"${refinement}>
  <section name="overview">Markdown content</section>
  </artifact_create>
  \`\`\`
  \`type\` (\`feature\` or \`task\`) and \`title\` are required. \`project\` is required for a feature and for a task outside a feature; a task inside a feature takes the feature's. \`ref\` names the new artifact so a later request of the same response can use it in \`parent\` or \`depends_on\` before its id exists; the result gives the id. ${access.fields.includes('refinement') ? 'A refinement left out is `pending`. ' : ''}A task that owes no refinement starts \`ready\`; anything else starts in the \`backlog\`.`;
}

function buildUpdateRequest(access: ArtifactAccess): string {
  const attributes = access.fields.filter(field => field !== 'pull_requests').map(field => FIELD_ATTRIBUTES[field]);
  const children = [
    ...(access.sections.length > 0 ? ['`<section name="..." mode="replace|append">Markdown</section>` (`replace` by default; `append` adds after the current content; an empty `replace` clears the section)'] : []),
    ...(access.fields.includes('pull_requests') ? [FIELD_ATTRIBUTES.pull_requests] : []),
  ];
  return `- \`<artifact_update id="T-1" note="why">...</artifact_update>\` changes an artifact; \`note\` is optional and kept in its history.${attributes.length > 0 ? ` Attributes you may set: ${attributes.join('; ')}.` : ''}${children.length > 0 ? ` Children: ${children.join('; ')}.` : ''} Leave out what does not change; a self-closing tag is enough when there is no child.`;
}

function buildRules(access: ArtifactAccess): string {
  const rules = [
    '#### Rules',
    ...(access.sections.length > 0 ? [`- Sections you write: ${access.sections.map(section => `\`${section}\``).join(', ')}. The others belong to other agents; read them, and comment when you disagree.`] : ['- You write no section. Record what the next agent must know as a comment on the artifact.']),
    ...(access.fields.length > 0 ? [`- Fields you change: ${access.fields.join(', ')}.`] : []),
    access.scope === 'task'
      ? '- You read tasks only, and you change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block. Read the tasks it depends on when they matter to your work.'
      : `- An artifact delegated to an agent is held by it until the agent finishes, and an artifact is with one agent at a time. Meanwhile you ${access.scope === 'board' ? 'change only its status and refinement states' : 'cannot change it'}; comment instead.`,
    ...(access.scope === 'tree' ? ['- When you were delegated an artifact, its content opens your prompt in a `[DELEGATED_ARTIFACT]` block, and you hold it while you work.'] : []),
    '- Write Markdown in sections and comments as you would in a document, self-contained: whoever reads an artifact does not see this conversation.',
  ];
  return rules.join('\n');
}
