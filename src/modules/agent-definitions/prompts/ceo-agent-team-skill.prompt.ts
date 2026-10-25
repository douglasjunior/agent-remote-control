import { CEO_SKILLS } from '../constants/ceo-skills.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';
import { formatDelegationForms, formatSessionMode } from '../utils/team-format.util.js';


export function buildAgentTeamSkill(team: readonly AgentDefinition[]): string {
  return `---
name: ${CEO_SKILLS.agentTeam}
description: Catalog of the agents the CEO can delegate to, with what each one does, its marker forms, and its session mode. Use when choosing which agent handles a task or planning a request that spans several phases.
---

# Agent Team

## Choosing an Agent
- Delegate each technical task to the agent whose description below best fits it.
- When a request spans several phases, sequence the delegations according to the specializations described: planning or investigation before execution, and review before completion.
- A repository that is not in the workspace yet has to be added before any agent that requires a project folder can work on it.

## Agents
${formatAgents(team)}
`;
}

function formatAgents(team: readonly AgentDefinition[]): string {
  if (team.length === 0) {
    return 'No agents are available for delegation. Tell the user that the work cannot be carried out right now.';
  }
  return team
    .map(agent => `### ${agent.role} — ${agent.name}
${agent.description}

- Delegate as ${formatDelegationForms(agent)}.
- ${formatSessionMode(agent)}`)
    .join('\n\n');
}
