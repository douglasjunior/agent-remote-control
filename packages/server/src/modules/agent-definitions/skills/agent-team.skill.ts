import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { formatDelegationForms } from '../utils/team-format.util.js';


export const AGENT_TEAM_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.agentTeam,
  description: `Catalog of the agents the CEO can delegate to, with what each one does, its <delegate> tag forms, and its session mode. Use when choosing which agent handles a task or planning a request that spans several phases.`,
  roles: ['CEO'],
  buildContent: ({ team }) => `# Agent Team

## Choosing an Agent
- Delegate each technical task to the agent whose description below best fits it.
- Order the phases of one item by dependency: discovery of what to build before its design, design before technical planning, planning or investigation before execution, and review before completion. Each phase is a status of the item's task on the board (see the \`${SKILL_NAMES.artifactBoard}\` skill). Different items, and phases that do not depend on each other, overlap across roles (see the \`${SKILL_NAMES.delegationProtocol}\` skill).
- Do not interview the user about requirements yourself: discovery belongs to the agent that runs it, which asks the user directly.
- A repository that is not in the workspace yet has to be added before any agent that requires a project folder can work on it.

## Agents
${formatAgents(team)}
`,
};

function formatAgents(team: readonly AgentDefinition[]): string {
  if (team.length === 0) {
    return 'No agents are available for delegation. Tell the user that the work cannot be carried out right now.';
  }
  return team
    .map(agent => `### ${agent.role} — ${agent.name}
${agent.description}

- Delegate as ${formatDelegationForms(agent)}.
- ${formatSessionMode(agent)}
- ${formatProjectAccess(agent)}
- ${formatArtifactUse(agent)}
- ${formatUserQuestions(agent)}${formatUserDecision(agent)}`)
    .join('\n\n');
}

function formatArtifactUse(agent: AgentDefinition): string {
  const { artifact, needsReviewableWork } = agent.delegation;
  if (!artifact) {
    return 'Takes no artifact.';
  }
  const kind = agent.artifacts.scope === 'task' ? 'a task' : 'a task or a feature';
  const pullRequest = needsReviewableWork ? ' The task must already have work to inspect: a linked pull request or a recorded branch.' : '';
  return artifact === 'required'
    ? `Always works on ${kind} of the board and runs in its project.${pullRequest}`
    : `May work on ${kind} of the board, then running in its project.${pullRequest}`;
}

function formatProjectAccess(agent: AgentDefinition): string {
  return agent.delegation.readOnly
    ? 'Read-only, so it may work alongside an agent that modifies the same project.'
    : 'Modifies files, so no other agent that modifies files may work in the same project folder at the same time.';
}

function formatSessionMode(agent: AgentDefinition): string {
  const mode = agent.defaultSessionMode ?? 'resume';
  const withoutArtifact = agent.delegation.sessionMode
    ? `runs in "${mode}" session mode unless you set session="new" or session="resume"`
    : `always runs in "${mode}" session mode, so never set the session attribute`;
  if (!agent.delegation.artifact) {
    return `${withoutArtifact.charAt(0).toUpperCase()}${withoutArtifact.slice(1)}.`;
  }
  return agent.delegation.artifact === 'required'
    ? 'Keeps one session per task: a new task starts with a clean context and the same task continues where it left off.'
    : `Keeps one session per artifact it is delegated; without an artifact it ${withoutArtifact}.`;
}

function formatUserDecision(agent: AgentDefinition): string {
  return agent.delegation.userInitiatedOnly
    ? `\n- Delegate to it only on the user's decision: suggest it with a \`<question>\` (options to go ahead or not) and delegate once the user agrees or asks for it explicitly. A delegation after an agent result, or without the user's say, is rejected.`
    : '';
}

function formatUserQuestions(agent: AgentDefinition): string {
  return agent.delegation.asksUser
    ? 'Asks the user directly for the decisions it needs while it works.'
    : 'Never asks the user: a decision it needs comes back in its result, for you to take to the user.';
}
