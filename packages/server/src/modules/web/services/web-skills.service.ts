import type { SkillDetail, SkillSummary } from '@agent-remote-control/protocol/skill';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentSkillsPort } from '../../orchestrator/ports/agent-skills.port.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


/** The skills of every role, for the browser to browse and to delete the user's own; changing one is a request to the CEO. */
@Injectable()
export class WebSkillsService {
  private readonly logger = new Logger(WebSkillsService.name);

  constructor(
    @Inject(IAgentSkillsPort) private readonly skills: IAgentSkillsPort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  async list(): Promise<SkillSummary[]> {
    return (await this.skills.listAll()).map(({ name, description, roles, builtIn }) => ({ name, description, roles: [...roles], builtIn }));
  }

  async get(name: string): Promise<SkillDetail | null> {
    const skill = await this.skills.readAny(name);
    return skill ? { name: skill.name, description: skill.description, roles: [...skill.roles], builtIn: skill.builtIn, content: skill.content } : null;
  }

  /** Deletes a user skill and tells every connection; the result is for the requester. */
  async delete(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!await this.skills.deleteUserSkill(name)) {
      return { ok: false, error: `No custom skill is named "${name}".` };
    }
    this.logger.log(`[Skill Deleted] ${name}`);
    this.registry.broadcast({ type: 'skill.deleted', name });
    return { ok: true };
  }
}
