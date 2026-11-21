import { Inject, Injectable } from '@nestjs/common';

import type { SquadView } from '../models/squad.model.js';
import { ISquadStorePort } from '../ports/squad-store.port.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';


@Injectable()
export class ListSquadsUseCase {
  constructor(
    @Inject(ISquadStorePort) private readonly squads: ISquadStorePort,
    private readonly profiles: AgentProfilesService,
  ) {}

  async execute(): Promise<readonly SquadView[]> {
    return (await this.squads.list()).map(squad => ({ ...squad, profiles: this.profiles.listSquadProfiles(squad) }));
  }
}
