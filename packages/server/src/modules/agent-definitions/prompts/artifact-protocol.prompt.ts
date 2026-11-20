import { AGENT_TOOLS_SERVER_NAME } from '../../orchestrator/constants/agent-tools.constant.js';
import type { AgentInterface } from '../../orchestrator/models/agent-interface.model.js';
import type { ArtifactAccess } from '../../orchestrator/ports/agent-registry.port.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';


/**
 * The board in brief, for the system prompt of an executor: what it holds, the requests the role uses in most tasks,
 * what it may write, and the skill with the rest. On the tools interface the schemas carry the grammar, so the brief
 * says what each tool is for and when to call it.
 */
export function buildArtifactProtocolBrief(access: ArtifactAccess, agentInterface: AgentInterface): string {
  const lines = [
    '### The Board',
    'The work of this conversation lives on a board of artifacts: features grouping the tasks of one initiative, and tasks, the unit one agent works on. Each has an id (`F-1`, `T-3`), a status, a branch, pull requests, comments, and its content in Markdown sections. The board is the memory of the team: whoever works on an artifact after you starts from what is written on it and never sees this session.',
    ...(agentInterface === 'tags' ? tagRequests(access) : toolRequests(access)),
    access.sections.length > 0
      ? `- Sections you write: ${access.sections.map(section => `\`${section}\``).join(', ')}${access.create && !access.sections.includes('overview') ? ', and the `overview` of an artifact you create' : ''}.${access.fields.length > 0 ? ` Fields you change: ${access.fields.join(', ')}.` : ''}`
      : `- You write no section${access.fields.length > 0 ? `; fields you change: ${access.fields.join(', ')}` : ''}. Record what the next agent must know as a comment.`,
    access.scope === 'task'
      ? '- You read tasks only and change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block.'
      : '- An artifact another agent holds is not changed under you; comment on it instead.',
    agentInterface === 'tags'
      ? `- Every other request and attribute (listing, dependencies, statuses, refinements, creating several artifacts at once) is in the \`${SKILL_NAMES.boardRequests}\` skill, written for your role: read it before a request you are not sure of.`
      : `- Listing, dependencies, statuses, refinements and what each field holds are in the \`${SKILL_NAMES.boardRequests}\` skill, written for your role: read it before a call you are not sure of.`,
  ];
  return lines.join('\n');
}

function tagRequests(access: ArtifactAccess): string[] {
  const writes = access.sections.length > 0 || access.fields.length > 0;
  const updateExample = [
    access.fields.includes('branch') ? ' branch="feat/t-1-login"' : '',
    access.fields.includes('status') ? ' status="in_progress"' : '',
  ].join('');
  const updateChildren = [
    ...(access.sections.length > 0 ? [`<section name="${access.sections[0]}">Markdown</section>`] : []),
    ...(access.fields.includes('pull_requests') ? ['<pull_request url="https://..." state="open"/>'] : []),
  ].join('');
  return [
    'You read and change it with requests written as plain text inside your final response:',
    `- \`<artifact_read id="T-1"/>\` reads the full content of ${access.scope === 'task' ? 'tasks' : 'artifacts'}.`,
    ...(writes ? [`- \`<artifact_update id="T-1"${updateExample}>${updateChildren}</artifact_update>\` changes an artifact.`] : []),
    ...(access.create ? ['- `<artifact_create type="task" title="..." project="my-app"><section name="overview">Markdown</section></artifact_create>` creates one.'] : []),
    '- `<artifact_comment id="T-1">text</artifact_comment>` comments on one.',
    `- Updates and comments go in the same final response as your final answer: they are carried out and the answer is delivered with them. A response that ${access.create ? 'reads or creates' : 'reads'} gets \`<request_results>\` back first${access.create ? ', with the id of each artifact created,' : ''} and is not your final answer: write that whole in a later response.`,
  ];
}

function toolRequests(access: ArtifactAccess): string[] {
  const writes = access.sections.length > 0 || access.fields.length > 0;
  return [
    `You read and change it with the tools of the \`${AGENT_TOOLS_SERVER_NAME}\` MCP server, which you call during your turn and which answer at once:`,
    `- \`artifact_read\` reads the full content of ${access.scope === 'task' ? 'tasks' : 'artifacts'}.`,
    ...(writes ? ['- `artifact_update` changes an artifact.'] : []),
    ...(access.create ? ['- `artifact_create` creates one and returns its id.'] : []),
    '- `artifact_comment` comments on one.',
    '- Write to the board before your final answer, which ends your turn. A call the board refuses returns the reason: correct it before you go on.',
  ];
}
