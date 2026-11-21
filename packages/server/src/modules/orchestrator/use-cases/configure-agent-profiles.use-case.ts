import { Injectable } from '@nestjs/common';

import type { ConfigureProfilesInput, ConfigureProfilesResult } from '../models/configure-profiles.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfileResolverService } from '../services/agent-profile-resolver.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';


@Injectable()
export class ConfigureAgentProfilesUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    private readonly resolver: AgentProfileResolverService,
    private readonly profiles: AgentProfilesService,
  ) {}

  async execute(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult> {
    if (!this.capabilities.listAgentOptions().some(option => option.id === input.agentId)) {
      return { ok: false, error: 'Unknown agent' };
    }
    const knownRoles = new Set(this.profiles.listRoles().map(({ role }) => role));
    if (input.roles?.some(role => !knownRoles.has(role))) {
      return { ok: false, error: 'Unknown role' };
    }
    const resolution = await this.resolver.resolve(input);
    if (!resolution.ok) {
      return resolution;
    }
    await this.profiles.save(input.conversationId, input.roles, resolution.profile);
    return { ok: true };
  }
}
