import type { AgentSkill, AgentSkillInput, AgentSkillListing, AgentSkillSummary, AgentSkillWriteResult } from '../models/agent-skill.model.js';


/**
 * The skills of each role: the catalog goes with the role's system prompt, and an agent reads a skill in full with a
 * `<skill_read>` request when its description matches the work at hand. A role that writes skills reads any skill,
 * lists them all with their roles and writes the user's skills.
 */
export interface IAgentSkillsPort {
  list(role: string): Promise<readonly AgentSkillSummary[]>;
  read(role: string, name: string): Promise<AgentSkill | undefined>;
  /** Every skill, for a role that writes skills; `undefined` for any other role. */
  listAll(role: string): Promise<readonly AgentSkillListing[] | undefined>;
  write(role: string, skill: AgentSkillInput): Promise<AgentSkillWriteResult>;
}

export const IAgentSkillsPort = Symbol('IAgentSkillsPort');
