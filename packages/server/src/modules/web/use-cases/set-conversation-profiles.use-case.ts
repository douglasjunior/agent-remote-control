import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';

import { GetConversationProfilesUseCase } from './get-conversation-profiles.use-case.js';


export type SetConversationProfilesInput = {
  readonly conversationId: string;
  /** Every role when omitted. */
  readonly roles?: readonly string[];
  readonly agentId: string;
  readonly modelId?: string;
  readonly effortId?: string;
};

export type SetConversationProfilesResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

@Injectable()
export class SetConversationProfilesUseCase {
  constructor(
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly getProfiles: GetConversationProfilesUseCase,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(input: SetConversationProfilesInput): Promise<SetConversationProfilesResult> {
    const result = await this.configuration.configureProfiles(input);
    if (result.ok) {
      const { configured, profiles } = await this.getProfiles.execute(input.conversationId);
      this.events.publishProfiles(input.conversationId, configured, profiles);
    }
    return result;
  }
}
