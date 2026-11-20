import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { SaveSquadInput, SaveSquadResult } from '../models/squad.model.js';
import { ISquadStorePort } from '../ports/squad-store.port.js';
import { AgentProfileResolverService, type OptionLists } from '../services/agent-profile-resolver.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';


/**
 * Creates or replaces a squad. Every profile is checked like a profile set on a conversation, so its agent must be
 * installed now; a conversation that applies the squad later takes it even when the agent is gone by then.
 */
@Injectable()
export class SaveSquadUseCase {
  private readonly logger = new Logger(SaveSquadUseCase.name);

  constructor(
    @Inject(ISquadStorePort) private readonly squads: ISquadStorePort,
    private readonly resolver: AgentProfileResolverService,
    private readonly profiles: AgentProfilesService,
  ) {}

  async execute(input: SaveSquadInput): Promise<SaveSquadResult> {
    const name = input.name.trim();
    if (name === '') {
      return { ok: false, error: 'A squad needs a name' };
    }
    const roles = Object.keys(input.profiles);
    if (roles.length === 0) {
      return { ok: false, error: 'A squad needs a profile for at least one role' };
    }
    const team = this.profiles.listRoles();
    if (roles.some(role => !team.some(known => known.role === role))) {
      return { ok: false, error: 'Unknown role' };
    }

    const lists: OptionLists = new Map();
    const profiles: Record<string, AgentProfileSettings> = {};
    for (const { role, roleName } of team) {
      const choice = input.profiles[role];
      if (!choice) {
        continue;
      }
      const resolution = await this.resolver.resolve(choice, lists);
      if (!resolution.ok) {
        return { ok: false, error: `${roleName}: ${resolution.error}` };
      }
      profiles[role] = resolution.profile;
    }

    const description = input.description?.trim();
    const outcome = await this.squads.save({
      ...(input.id !== undefined && { id: input.id }),
      name,
      ...(description && { description }),
      isDefault: input.isDefault,
      profiles,
    });
    if (!outcome.ok) {
      return { ok: false, error: outcome.reason === 'name-taken' ? `Another squad is named "${name}"` : 'Unknown squad' };
    }
    this.logger.log(`[Squad Saved] ${outcome.squad.name}`);
    return outcome;
  }
}
