import { Inject, Injectable, Logger } from '@nestjs/common';

import type { ApplySquadResult } from '../models/squad.model.js';
import { ISquadStorePort } from '../ports/squad-store.port.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';


/**
 * Copies a squad's profiles into a conversation, roles whose agent is not installed included, like settings saved
 * earlier; later changes to the squad leave the conversation as it is.
 */
@Injectable()
export class ApplySquadToConversationUseCase {
  private readonly logger = new Logger(ApplySquadToConversationUseCase.name);

  constructor(
    @Inject(ISquadStorePort) private readonly squads: ISquadStorePort,
    private readonly profiles: AgentProfilesService,
  ) {}

  async execute(conversationId: string, squadId: string): Promise<ApplySquadResult> {
    const squad = await this.squads.get(squadId);
    if (!squad) {
      return { ok: false, error: 'Unknown squad' };
    }
    await this.profiles.applySquad(conversationId, squad);
    this.logger.log(`[Squad Applied] ${squad.name}`);
    return { ok: true };
  }
}
