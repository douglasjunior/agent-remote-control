import type { WorkspaceFile } from '../../orchestrator/models/workspace-file.model.js';
import { CEO_SKILLS, ceoSkillPath } from '../constants/ceo-skills.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';

import { buildAgentTeamSkill } from './ceo-agent-team-skill.prompt.js';
import { buildCeoAgentsMd } from './ceo-agents-md.prompt.js';
import { buildDelegationSkill } from './ceo-delegation-skill.prompt.js';
import { buildResponseSkill } from './ceo-response-skill.prompt.js';
import { buildWorkspaceNavigationSkill } from './ceo-workspace-navigation-skill.prompt.js';


export function buildCeoWorkspaceFiles(
  team: readonly AgentDefinition[],
  workspaceDir: string,
): readonly WorkspaceFile[] {
  return [
    { path: 'AGENTS.md', content: buildCeoAgentsMd(workspaceDir) },
    { path: ceoSkillPath(CEO_SKILLS.agentTeam), content: buildAgentTeamSkill(team) },
    { path: ceoSkillPath(CEO_SKILLS.delegationProtocol), content: buildDelegationSkill(workspaceDir) },
    { path: ceoSkillPath(CEO_SKILLS.responseProtocol), content: buildResponseSkill(workspaceDir) },
    { path: ceoSkillPath(CEO_SKILLS.workspaceNavigation), content: buildWorkspaceNavigationSkill(workspaceDir) },
  ];
}
