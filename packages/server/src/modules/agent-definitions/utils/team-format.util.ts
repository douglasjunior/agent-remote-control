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

export function formatArtifactUse(agent: AgentDefinition): string {
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

export function formatProjectAccess(agent: AgentDefinition): string {
  return agent.delegation.readOnly
    ? 'Read-only, so it may work alongside an agent that modifies the same project.'
    : 'Modifies files, so no other agent that modifies files may work in the same project folder at the same time.';
}

export function formatSessionMode(agent: AgentDefinition): string {
  const mode = agent.defaultSessionMode ?? 'resume';
  return agent.delegation.sessionMode
    ? `Runs in "${mode}" session mode unless you set session="new" or session="resume".`
    : `Always runs in "${mode}" session mode, so never set the session attribute.`;
}
