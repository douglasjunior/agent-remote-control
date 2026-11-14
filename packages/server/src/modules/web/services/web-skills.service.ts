import type { SkillDetail, SkillSummary } from '@agent-remote-control/protocol/skill';
import { Inject, Injectable } from '@nestjs/common';

import { IAgentSkillsPort } from '../../orchestrator/ports/agent-skills.port.js';


/** The skills of every role, for the browser to browse; changing one is a request to the CEO. */
@Injectable()
export class WebSkillsService {
  constructor(@Inject(IAgentSkillsPort) private readonly skills: IAgentSkillsPort) {}

  async list(): Promise<SkillSummary[]> {
    return (await this.skills.listAll()).map(({ name, description, roles, builtIn }) => ({ name, description, roles: [...roles], builtIn }));
  }

  async get(name: string): Promise<SkillDetail | null> {
    const skill = await this.skills.readAny(name);
    return skill ? { name: skill.name, description: skill.description, roles: [...skill.roles], builtIn: skill.builtIn, content: skill.content } : null;
  }
}
