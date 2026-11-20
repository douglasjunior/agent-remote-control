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

/** What a delegation to the agent names, in the words of the team list: the full tag forms belong to the catalog of the team. */
export function formatDelegationTargets(agent: AgentDefinition): string {
  const { project, artifact } = agent.delegation;
  const kind = agent.artifacts.scope === 'task' ? 'a task' : 'a task or a feature';
  if (artifact === 'required') {
    return `with \`artifact\` (${kind})`;
  }
  const targets = [
    ...(artifact ? [`with \`artifact\` (${kind})`] : []),
    ...(project ? ['with `project`'] : []),
    ...(project === 'required' ? [] : ['with neither']),
  ];
  return targets.length > 1 ? `${targets.slice(0, -1).join(', ')} or ${targets.at(-1)}` : targets[0]!;
}
