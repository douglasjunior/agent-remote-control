import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { ConversationProfiles } from '../models/conversation-profiles.model.js';
import { toRoleProfile } from '../utils/role-profile.util.js';


@Injectable()
export class GetConversationProfilesUseCase {
  constructor(@Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort) {}

  async execute(conversationId: string): Promise<ConversationProfiles> {
    const roles = await this.configuration.listProfiles(conversationId);
    const { appliedSquad, customized } = await this.configuration.getSquadState(conversationId);
    return {
      configured: await this.configuration.hasSettings(conversationId),
      profiles: roles.map(toRoleProfile),
      ...(appliedSquad && { appliedSquad: { id: appliedSquad.id, name: appliedSquad.name } }),
      customized,
    };
  }
}
