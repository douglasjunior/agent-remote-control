import type { AgentDefinition } from '../models/agent-definition.model.js';


export function formatDelegationForms(agent: AgentDefinition): string {
  const { project, artifact } = agent.delegation;
  const forms: string[] = [];
  if (artifact) {
    forms.push(`<delegate role="${agent.role}" summary="<summary>" artifact="<${agent.artifacts.scope === 'task' ? 'task' : 'artifact'} id>">`);
  }
  if (artifact !== 'required' && project !== 'required') {
    forms.push(`<delegate role="${agent.role}" summary="<summary>">`);
  }
  if (artifact !== 'required' && project) {
    forms.push(`<delegate role="${agent.role}" summary="<summary>" project="<project-folder>">`);
  }
  return forms.join(' or ');
}
