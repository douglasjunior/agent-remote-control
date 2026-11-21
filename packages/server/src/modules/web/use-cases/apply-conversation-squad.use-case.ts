import { Inject, Injectable } from '@nestjs/common';

import type { ApplySquadResult } from '../../orchestrator/models/squad.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';

import { GetConversationProfilesUseCase } from './get-conversation-profiles.use-case.js';


/** Applies a squad to a conversation and lets every connection see its new profiles. */
@Injectable()
export class ApplyConversationSquadUseCase {
  constructor(
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly getProfiles: GetConversationProfilesUseCase,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string, squadId: string): Promise<ApplySquadResult> {
    const result = await this.configuration.applySquad(conversationId, squadId);
    if (result.ok) {
      this.events.publishProfiles(conversationId, await this.getProfiles.execute(conversationId));
    }
    return result;
  }
}
