import type { AgentSkillInput } from '../../orchestrator/models/agent-skill.model.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


/** Skills the user keeps outside the code, which add to the built-in ones or replace one of the same name. */
export interface IUserSkillStorePort {
  list(): Promise<readonly AgentSkillDefinition[]>;
  /** Creates or replaces the skill of the same name; `true` when it did not exist. */
  write(skill: AgentSkillInput): Promise<boolean>;
}

export const IUserSkillStorePort = Symbol('IUserSkillStorePort');
