import type {
  AgentSkill,
  AgentSkillInput,
  AgentSkillListing,
  AgentSkillSummary,
  AgentSkillWriteResult,
} from '../models/agent-skill.model.js';
import type { IAgentSkillsPort } from '../ports/agent-skills.port.js';


export class StubAgentSkillsPort implements IAgentSkillsPort {
  skills: Record<string, readonly AgentSkill[]> = {};
  listing: readonly AgentSkillListing[] | undefined;
  writeResult: AgentSkillWriteResult = { ok: true, created: true };
  readonly written: AgentSkillInput[] = [];

  async list(role: string): Promise<readonly AgentSkillSummary[]> {
    return (this.skills[role] ?? []).map(({ name, description }) => ({ name, description }));
  }

  async read(role: string, name: string): Promise<AgentSkill | undefined> {
    return (this.skills[role] ?? []).find(skill => skill.name === name);
  }

  async listAll(): Promise<readonly AgentSkillListing[] | undefined> {
    return this.listing;
  }

  async write(_role: string, skill: AgentSkillInput): Promise<AgentSkillWriteResult> {
    this.written.push(skill);
    return this.writeResult;
  }
}
