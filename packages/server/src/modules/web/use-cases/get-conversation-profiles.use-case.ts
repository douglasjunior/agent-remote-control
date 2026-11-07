import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';


export type ConversationProfiles = {
  /** Whether a message sent now runs: the conversation has settings, or can inherit the most recent ones. */
  readonly configured: boolean;
  readonly profiles: readonly RoleProfile[];
};

@Injectable()
export class GetConversationProfilesUseCase {
  constructor(@Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort) {}

  async execute(conversationId: string): Promise<ConversationProfiles> {
    const roles = await this.configuration.listProfiles(conversationId);
    return {
      configured: await this.configuration.hasSettings(conversationId),
      profiles: roles.map(({ role, roleName, profile, agentAvailable }): RoleProfile => ({
        role,
        roleName,
        ...(profile
          ? {
            agent: { id: profile.agentId, name: profile.agentName, available: agentAvailable ?? false },
            ...(profile.modelId ? { model: { id: profile.modelId, name: profile.modelName ?? profile.modelId } } : {}),
            ...(profile.effortId ? { effort: { id: profile.effortId, name: profile.effortName ?? profile.effortId } } : {}),
          }
          : {}),
      })),
    };
  }
}
