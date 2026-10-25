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

export function formatSessionMode(agent: AgentDefinition): string {
  const mode = agent.defaultSessionMode ?? 'resume';
  return agent.delegation.sessionMode
    ? `Runs in "${mode}" session mode unless you append :new or :resume.`
    : `Always runs in "${mode}" session mode, so never append :new or :resume.`;
}
