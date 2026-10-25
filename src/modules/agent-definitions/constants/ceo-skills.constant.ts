const CEO_SKILLS_DIR = '.agents/skills';

export const CEO_SKILLS = {
  agentTeam: 'agent-team',
  delegationProtocol: 'delegation-protocol',
  responseProtocol: 'response-protocol',
  workspaceNavigation: 'workspace-navigation',
} as const;

export function ceoSkillPath(name: string): string {
  return `${CEO_SKILLS_DIR}/${name}/SKILL.md`;
}
