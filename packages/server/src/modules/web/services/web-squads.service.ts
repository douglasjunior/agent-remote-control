import type { Squad, SquadProfileInput } from '@agent-remote-control/protocol/squad';
import { Inject, Injectable } from '@nestjs/common';

import type { SquadView } from '../../orchestrator/models/squad.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { toRoleProfile } from '../utils/role-profile.util.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


export type SquadInput = {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly profiles: Readonly<Record<string, SquadProfileInput>>;
};

type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The squads page: a change is broadcast to every connection, so every open page and settings sheet shows it. */
@Injectable()
export class WebSquadsService {
  constructor(
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  async list(): Promise<Squad[]> {
    return (await this.configuration.listSquads()).map(squad => this.toSquad(squad));
  }

  async save(input: SquadInput): Promise<Outcome> {
    const result = await this.configuration.saveSquad(input);
    if (!result.ok) {
      return result;
    }
    await this.publish();
    return { ok: true };
  }

  async delete(squadId: string): Promise<Outcome> {
    if (!await this.configuration.deleteSquad(squadId)) {
      return { ok: false, error: 'Unknown squad' };
    }
    await this.publish();
    return { ok: true };
  }

  private async publish(): Promise<void> {
    this.registry.broadcast({ type: 'squads', squads: await this.list() });
  }

  private toSquad({ id, name, description, isDefault, profiles, createdAt, updatedAt }: SquadView): Squad {
    return {
      id,
      name,
      ...(description !== undefined && { description }),
      isDefault,
      profiles: profiles.map(toRoleProfile),
      createdAt,
      updatedAt,
    };
  }
}
