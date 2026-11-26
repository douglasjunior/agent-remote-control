import {
  ARTIFACT_SECTION_TITLES,
  ARTIFACT_SECTIONS,
  ARTIFACT_STATUSES,
  DEFAULT_REFINEMENT_STATES,
  FROZEN_STATUS,
  REFINEMENT_KINDS,
  REFINEMENT_STATES,
} from '../../artifacts/constants/artifact-catalog.constant.js';
import { AGENT_TOOLS_SERVER_NAME } from '../../orchestrator/constants/agent-tools.constant.js';
import type { AgentInterface } from '../../orchestrator/models/agent-interface.model.js';
import type { ArtifactAccess, ArtifactField } from '../../orchestrator/ports/agent-registry.port.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


const STATUS_RULE = 'the server sets the status a delegation or a verdict leaves, so set one only for a decision; `frozen` is set by the server on a task that went through too many delegations, and only the user takes a task out of it';

const FIELD_ATTRIBUTES: Readonly<Record<ArtifactField, string>> = {
  title: 'title="..."',
  parent: 'parent="F-1" (or "none")',
  project: 'project="<project-folder>" for a task, projects="<project-folder>,<project-folder>" for a feature',
  depends_on: 'depends_on="T-1,T-2" (or "none")',
  status: `status="${ARTIFACT_STATUSES.filter(status => status !== FROZEN_STATUS).join('|')}" (${STATUS_RULE})`,
  refinement: REFINEMENT_KINDS.map(kind => `${kind}_refinement="${REFINEMENT_STATES.join('|')}"`).join(', '),
  branch: 'branch="<branch name>" (or "none")',
  pull_requests: '<pull_request url="https://..." title="..." state="open|merged|closed" repository="<path inside the project folder, . by default>"/> inside the tag, one per pull request',
};

const REFINEMENT_DEFAULTS = `A refinement left out takes its default: ${REFINEMENT_KINDS.map(kind => `\`${kind}_refinement="${DEFAULT_REFINEMENT_STATES[kind]}"\``).join(', ')}.`;

/** The board and how the reader works on it, written for its access and interface; its system prompt carries it in brief. */
export const BOARD_REQUESTS_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.boardRequests,
  description: 'The board in full, written for your role: listing, dependencies, statuses, refinements, creating several artifacts at once and what each field holds. Your instructions already cover reading, updating and commenting on the task you hold. Read it only for something beyond them.',
  roles: ['GIT_OPS', 'PRODUCT_OWNER', 'UX_DESIGNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'QA'],
  buildContent: ({ artifacts, agentInterface }) => `# Board Requests\n\n${buildBoardRequestsBody(artifacts, agentInterface)}`,
};

/**
 * The board and how one role works on it, written from what it may do. On the tags interface that is the request
 * grammar, whose results come back in the agent's next prompt; on the tools interface the schemas carry the grammar,
 * so it says what each tool is for and the rules of the fields.
 */
export function buildBoardRequestsBody(access: ArtifactAccess, agentInterface: AgentInterface): string {
  return `${buildModel()}

${agentInterface === 'tags' ? buildTagRequests(access) : buildTools(access)}

${buildRules(access)}`;
}

function buildModel(): string {
  return `The work of this conversation lives on a board of artifacts. A feature groups the tasks of one initiative; a task is the unit one agent works on, inside a feature or on its own. A feature links one or more project folders of the workspace root, and a task works in exactly one of them. A project folder may hold several nested git repositories, and a task in it may change any of them. An initiative across several projects, such as a separate backend and frontend, is one feature linking them, never one feature per project. Every artifact has an id such as \`F-1\` or \`T-3\`, a status (${ARTIFACT_STATUSES.join(', ')}), the ${REFINEMENT_KINDS.join(', ')} refinement states (${REFINEMENT_STATES.join(', ')}), dependencies on its siblings (a feature on other features, a task on the other tasks of its feature, a standalone task on other standalone tasks), a branch, pull requests, comments, and content split in sections:
${ARTIFACT_SECTIONS.map(section => `- \`${section}\`: ${ARTIFACT_SECTION_TITLES[section]}`).join('\n')}`;
}

function buildTagRequests(access: ArtifactAccess): string {
  return `You read and change the board with requests written inside your final response. The orchestrator carries them out in order, before anything else in the response, and answers with an \`<request_results>\` block, one \`<request_result>\` per request with \`status="ok"\` or \`status="error"\` and the reason. When the response also ${access.scope === 'board' ? 'delegates or asks the user questions' : 'asks the user questions'}, it goes on as usual and the results open your next prompt. Updates and comments ride with your final answer: they are carried out and the answer is delivered, unless one of them fails. A response that reads (list, read) or creates, or whose request failed, gets the results right away, with the id of each artifact created, and is not taken as your final answer: give it whole in a later response. Write the tags as plain text, never inside code fences.

${buildRequests(access)}`;
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
    ? REFINEMENT_KINDS.map(kind => ` ${kind}_refinement="${DEFAULT_REFINEMENT_STATES[kind]}"`).join('')
    : '';
  return `- Create an artifact, with the sections you write as children:
  \`\`\`text
  <artifact_create type="task" title="Short title" project="my-app" parent="F-1" depends_on="T-1" ref="login-api"${refinement}>
  <section name="overview">Markdown content</section>
  </artifact_create>
  \`\`\`
  \`type\` (\`feature\` or \`task\`) and \`title\` are required, and the \`overview\` of an artifact is yours to write when you create it. \`projects\` (a comma-separated list on the tags) is required for a feature; a task takes one \`project\`, left out only inside a feature that links a single project. \`ref\` names the new artifact so a later request of the same response can use it in \`parent\` or \`depends_on\` before its id exists; the result gives the id. ${access.fields.includes('refinement') ? `${REFINEMENT_DEFAULTS} ` : ''}A task that owes no refinement starts \`ready\`; anything else starts in the \`backlog\`.`;
}

function buildUpdateRequest(access: ArtifactAccess): string {
  const attributes = access.fields.filter(field => field !== 'pull_requests').map(field => FIELD_ATTRIBUTES[field]);
  const children = [
    ...(access.sections.length > 0 ? ['`<section name="..." mode="replace|append">Markdown</section>` (`replace` by default; `append` adds after the current content; an empty `replace` clears the section)'] : []),
    ...(access.fields.includes('pull_requests') ? [FIELD_ATTRIBUTES.pull_requests] : []),
  ];
  return `- \`<artifact_update id="T-1" note="why">...</artifact_update>\` changes an artifact; \`note\` is optional and kept in its history.${attributes.length > 0 ? ` Attributes you may set: ${attributes.join('; ')}.` : ''}${children.length > 0 ? ` Children: ${children.join('; ')}.` : ''} Leave out what does not change; a self-closing tag is enough when there is no child.`;
}

function buildTools(access: ArtifactAccess): string {
  const lines = [
    `You read and change the board with the tools of the \`${AGENT_TOOLS_SERVER_NAME}\` MCP server, during your turn and before your final answer. Each call is carried out at once and returns its result: what you read, the id of what you created, or the reason the board refused the call, so you correct it before going on. The schema of each tool gives its arguments; what follows is what each one is for.`,
    '',
    '#### Tools',
    access.scope === 'task'
      ? '- `artifact_list` lists the tasks of the board, one line each: the open ones (neither done nor cancelled) unless you name statuses, or `all`.'
      : '- `artifact_list` lists artifacts, one line each, filtered by type, status, parent and project: the open ones (neither done nor cancelled) unless you name statuses, or `all`. The parent `none` lists the features and the tasks outside any feature.',
    access.scope === 'task'
      ? '- `artifact_read` reads the full content of tasks, such as the tasks yours depends on.'
      : `- \`artifact_read\` reads the full content of artifacts; a feature comes with the list of its tasks${access.scope === 'tree' ? ', and with `tree` with the full content of every task under it' : ''}.`,
    ...(access.create ? [buildCreateTool(access)] : []),
    ...(access.sections.length > 0 || access.fields.length > 0 ? [buildUpdateTool(access)] : []),
    '- `artifact_comment` adds a comment to the artifact, kept in its history and shown to whoever reads it.',
  ];
  return lines.join('\n');
}

function buildCreateTool(access: ArtifactAccess): string {
  return `- \`artifact_create\` creates a feature or a task and returns its id, which the \`parent\` and \`depends_on\` of the next creations take. The \`overview\` of what you create is yours to write. \`projects\` is required for a feature; a task takes one \`project\`, left out only inside a feature that links a single project. ${access.fields.includes('refinement') ? `${REFINEMENT_DEFAULTS} ` : ''}A task that owes no refinement starts \`ready\`; anything else starts in the \`backlog\`.`;
}

function buildUpdateTool(access: ArtifactAccess): string {
  const rules = [
    ...(access.fields.includes('status') ? [`${STATUS_RULE.charAt(0).toUpperCase()}${STATUS_RULE.slice(1)}.`] : []),
    ...(access.sections.length > 0 ? ['A section is replaced unless you append to it, and an empty replacement clears it.'] : []),
    ...(access.fields.includes('pull_requests') ? ['A pull request with the URL of one already linked updates it.'] : []),
  ];
  return [`- \`artifact_update\` changes an artifact: give only what changes, with a \`note\` saying why when it helps, kept in its history.`, ...rules].join(' ');
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
