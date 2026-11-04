import { Injectable } from '@nestjs/common';

import type { AgentOption } from '../models/agent-option.model.js';
import type { ConfigureProfilesInput, ConfigureProfilesResult } from '../models/configure-profiles.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';


@Injectable()
export class ConfigureAgentProfilesUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    private readonly profiles: AgentProfilesService,
  ) {}

  async execute(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult> {
    const agent = this.capabilities.listAgentOptions().find(option => option.id === input.agentId);
    if (!agent) {
      return { ok: false, error: 'Unknown agent' };
    }
    const knownRoles = new Set(this.profiles.listRoles().map(({ role }) => role));
    if (input.roles?.some(role => !knownRoles.has(role))) {
      return { ok: false, error: 'Unknown role' };
    }

    let model: AgentOption | undefined;
    if (input.modelId) {
      model = (await this.capabilities.listModelOptions(agent.id)).find(option => option.id === input.modelId);
      if (!model) {
        return { ok: false, error: 'Unknown model' };
      }
    }

    let effort: AgentOption | undefined;
    if (input.effortId) {
      if (!model) {
        return { ok: false, error: 'An effort needs a model' };
      }
      effort = (await this.capabilities.listEffortOptions(agent.id, model.id)).find(option => option.id === input.effortId);
      if (!effort) {
        return { ok: false, error: 'Unknown effort' };
      }
    }

    await this.profiles.save(input.conversationId, input.roles, {
      agentId: agent.id,
      agentName: agent.name,
      modelId: model?.id ?? null,
      modelName: model?.name ?? null,
      effortId: effort?.id ?? null,
      effortName: effort?.name ?? null,
    });
    return { ok: true };
  }
}
