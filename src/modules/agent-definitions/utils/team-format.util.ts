import type { AgentDefinition } from '../models/agent-definition.model.js';


export function formatDelegationForms(agent: AgentDefinition): string {
  const { project } = agent.delegation;
  const forms: string[] = [];
  if (project !== 'required') {
    forms.push(`[DELEGATE:${agent.role}]`);
  }
  if (project) {
    forms.push(`[DELEGATE:${agent.role}:<project-folder>]`);
  }
  return forms.join(' or ');
}

export function formatProjectAccess(agent: AgentDefinition): string {
  return agent.delegation.readOnly
    ? 'Read-only, so it may work alongside an agent that modifies the same project.'
    : 'Modifies files, so no other agent that modifies files may work in the same project folder at the same time.';
}

export function formatSessionMode(agent: AgentDefinition): string {
  const mode = agent.defaultSessionMode ?? 'resume';
  return agent.delegation.sessionMode
    ? `Runs in "${mode}" session mode unless you append :new or :resume.`
    : `Always runs in "${mode}" session mode, so never append :new or :resume.`;
}
