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
  listing: readonly AgentSkillListing[] = [];
  writers: readonly string[] = ['CEO'];
  writeResult: AgentSkillWriteResult = { ok: true, created: true };
  readonly written: AgentSkillInput[] = [];
  readonly deleted: string[] = [];

  async list(role: string): Promise<readonly AgentSkillSummary[]> {
    return (this.skills[role] ?? []).map(({ name, description }) => ({ name, description }));
  }

  async read(role: string, name: string): Promise<AgentSkill | undefined> {
    return (this.skills[role] ?? []).find(skill => skill.name === name);
  }

  async listAll(): Promise<readonly AgentSkillListing[]> {
    return this.listing;
  }

  async readAny(name: string): Promise<(AgentSkill & AgentSkillListing) | undefined> {
    const listed = this.listing.find(skill => skill.name === name);
    const skill = Object.values(this.skills).flat().find(candidate => candidate.name === name);
    return listed && skill ? { ...listed, content: skill.content } : undefined;
  }

  writesSkills(role: string): boolean {
    return this.writers.includes(role);
  }

  async deleteUserSkill(name: string): Promise<boolean> {
    const custom = this.listing.some(skill => skill.name === name && !skill.builtIn);
    if (custom) {
      this.deleted.push(name);
    }
    return custom;
  }

  async write(_role: string, skill: AgentSkillInput): Promise<AgentSkillWriteResult> {
    this.written.push(skill);
    return this.writeResult;
  }
}
