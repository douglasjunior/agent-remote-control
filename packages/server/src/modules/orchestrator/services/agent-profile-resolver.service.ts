import { Injectable } from '@nestjs/common';

import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { AgentProfileChoice } from '../models/squad.model.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';


export type ProfileResolution = { readonly ok: true; readonly profile: AgentProfileSettings } | { readonly ok: false; readonly error: string };

/** Lists already asked for, by agent or by agent and model, so resolving several profiles probes each agent once. */
export type OptionLists = Map<string, Promise<readonly AgentOption[]>>;

/** Checks the ids of a profile against the installed agents and the lists of the agent, and takes the names from them. */
@Injectable()
export class AgentProfileResolverService {
  constructor(private readonly capabilities: AgentCapabilitiesService) {}

  async resolve(choice: AgentProfileChoice, lists: OptionLists = new Map()): Promise<ProfileResolution> {
    const agent = this.capabilities.listAgentOptions().find(option => option.id === choice.agentId);
    if (!agent) {
      return { ok: false, error: 'Unknown agent' };
    }

    let model: AgentOption | undefined;
    if (choice.modelId) {
      model = (await this.list(lists, agent.id, () => this.capabilities.listModelOptions(agent.id))).find(option => option.id === choice.modelId);
      if (!model) {
        return { ok: false, error: 'Unknown model' };
      }
    }

    let effort: AgentOption | undefined;
    if (choice.effortId) {
      if (!model) {
        return { ok: false, error: 'An effort needs a model' };
      }
      const modelId = model.id;
      effort = (await this.list(lists, `${agent.id}\n${modelId}`, () => this.capabilities.listEffortOptions(agent.id, modelId)))
        .find(option => option.id === choice.effortId);
      if (!effort) {
        return { ok: false, error: 'Unknown effort' };
      }
    }

    return {
      ok: true,
      profile: {
        agentId: agent.id,
        agentName: agent.name,
        modelId: model?.id ?? null,
        modelName: model?.name ?? null,
        effortId: effort?.id ?? null,
        effortName: effort?.name ?? null,
      },
    };
  }

  private list(lists: OptionLists, key: string, read: () => Promise<readonly AgentOption[]>): Promise<readonly AgentOption[]> {
    let list = lists.get(key);
    if (!list) {
      list = read();
      lists.set(key, list);
    }
    return list;
  }
}
