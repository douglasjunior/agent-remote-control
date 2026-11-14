import type { ArtifactAccess } from '../../orchestrator/ports/agent-registry.port.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';


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
    `- Every other request and attribute (listing, dependencies, statuses, refinements, creating several artifacts at once) is in the \`${SKILL_NAMES.boardRequests}\` skill, written for your role: read it before a request you are not sure of.`,
  ];
  return lines.join('\n');
}

export function buildArtifactProtocolReminder(access: ArtifactAccess): string {
  const scope = access.scope === 'task'
    ? 'You read tasks and change only the task you were delegated.'
    : 'An artifact another agent holds is not changed under you; comment on it instead.';
  return `- Read and change the board only with artifact requests; a response with nothing but requests gets their results right away, and your final answer comes in a response without them. ${scope} When the request grammar is no longer in front of you, read the \`${SKILL_NAMES.boardRequests}\` skill before writing a request.`;
}
