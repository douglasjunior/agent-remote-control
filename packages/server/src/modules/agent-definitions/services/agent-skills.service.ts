import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentSkill,
  AgentSkillInput,
  AgentSkillListing,
  AgentSkillSummary,
  AgentSkillWriteResult,
} from '../../orchestrator/models/agent-skill.model.js';
import type { IAgentSkillsPort } from '../../orchestrator/ports/agent-skills.port.js';
import { WorkspaceDirectoryService } from '../../paths/services/workspace-directory.service.js';
import { BUILT_IN_SKILLS } from '../constants/built-in-skills.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { IUserSkillStorePort } from '../ports/user-skill-store.port.js';

import { AgentRegistryService } from './agent-registry.service.js';


const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const MAX_SKILL_CONTENT_LENGTH = 30_000;

/**
 * The built-in skills plus the user's own, a user skill replacing a built-in one of the same name. A role reads the
 * skills whose `roles` name it; a role that writes skills reads any of them and writes the user's skills, never a
 * built-in one.
 */
@Injectable()
export class AgentSkillsService implements IAgentSkillsPort {
  constructor(
    private readonly registry: AgentRegistryService,
    @Inject(IUserSkillStorePort) private readonly userSkills: IUserSkillStorePort,
    private readonly workspaceDirectory: WorkspaceDirectoryService,
  ) {}

  async list(role: string): Promise<readonly AgentSkillSummary[]> {
    return (await this.allSkills()).filter(skill => this.isFor(skill, role)).map(({ name, description }) => ({ name, description }));
  }

  async read(role: string, name: string): Promise<AgentSkill | undefined> {
    const readable = (await this.allSkills()).filter(skill => this.writesSkills(role) || this.isFor(skill, role));
    const skill = this.find(readable, name);
    return skill && { name: skill.name, description: skill.description, content: this.contentOf(skill, role) };
  }

  async listAll(): Promise<readonly AgentSkillListing[]> {
    return (await this.allSkills()).map(skill => this.listingOf(skill));
  }

  async readAny(name: string): Promise<(AgentSkill & AgentSkillListing) | undefined> {
    const skill = this.find(await this.allSkills(), name);
    return skill && { ...this.listingOf(skill), content: this.contentOf(skill, skill.roles[0] ?? '') };
  }

  writesSkills(role: string): boolean {
    return this.registry.getDefinition(role)?.writesSkills === true;
  }

  async write(role: string, skill: AgentSkillInput): Promise<AgentSkillWriteResult> {
    const error = this.writeRefusal(role, skill);
    if (error) {
      return { ok: false, error };
    }
    const roles = skill.roles.map(allowed => this.registry.getDefinition(allowed)!.role);
    return { ok: true, created: await this.userSkills.write({ ...skill, roles }) };
  }

  deleteUserSkill(name: string): Promise<boolean> {
    return this.userSkills.delete(name);
  }

  private writeRefusal(role: string, { name, description, roles, content }: AgentSkillInput): string | undefined {
    if (!this.writesSkills(role)) {
      return 'You cannot write skills.';
    }
    if (!SKILL_NAME.test(name) || name.length > MAX_SKILL_NAME_LENGTH) {
      return `Name the skill in lowercase kebab-case, up to ${MAX_SKILL_NAME_LENGTH} characters, as in electron-testing.`;
    }
    if (BUILT_IN_SKILLS.some(skill => skill.name === name)) {
      return `"${name}" is a built-in skill and is not replaced from a conversation. Choose another name.`;
    }
    if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
      return `The description has ${description.length} characters; keep it within ${MAX_SKILL_DESCRIPTION_LENGTH}.`;
    }
    if (content.length > MAX_SKILL_CONTENT_LENGTH) {
      return `The content has ${content.length} characters; keep it within ${MAX_SKILL_CONTENT_LENGTH}, or split it into several skills.`;
    }
    const unknown = roles.filter(allowed => !this.registry.hasRole(allowed));
    return unknown.length > 0
      ? `Unknown role ${unknown.map(allowed => `"${allowed}"`).join(', ')}. The roles are: ${this.registry.listRoles().join(', ')}.`
      : undefined;
  }

  private async allSkills(): Promise<readonly AgentSkillDefinition[]> {
    const own = await this.userSkills.list();
    const names = new Set(own.map(skill => skill.name.toLowerCase()));
    return [...BUILT_IN_SKILLS.filter(skill => !names.has(skill.name.toLowerCase())), ...own];
  }

  private find(skills: readonly AgentSkillDefinition[], name: string): AgentSkillDefinition | undefined {
    return skills.find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
  }

  private contentOf(skill: AgentSkillDefinition, role: string): string {
    return skill.buildContent({
      team: this.registry.getTeam(role),
      artifacts: this.registry.getArtifactAccess(role),
      workspaceDir: this.workspaceDirectory.resolve(),
    });
  }

  private listingOf(skill: AgentSkillDefinition): AgentSkillListing {
    return { name: skill.name, description: skill.description, roles: skill.roles, builtIn: BUILT_IN_SKILLS.includes(skill) };
  }

  private isFor(skill: AgentSkillDefinition, role: string): boolean {
    return skill.roles.some(allowed => allowed.toUpperCase() === role.toUpperCase());
  }
}
