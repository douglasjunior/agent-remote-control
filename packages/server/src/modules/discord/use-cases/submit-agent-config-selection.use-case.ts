import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { AgentConfigSelectionOutcome } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
  SelectionOption,
} from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { AgentProfileListService } from '../services/agent-profile-list.service.js';
import { toSelectionOptions } from '../utils/selection-options.util.js';


const OPTION_NUMBER_PATTERN = /^\d+$/;
const OPTION_SEPARATOR_PATTERN = /[\s,]+/;
const EXIT_INPUT = '0';

export type SubmitAgentConfigSelectionInput = {
  readonly conversationId: string;
  readonly input: string;
};

@Injectable()
export class SubmitAgentConfigSelectionUseCase {
  constructor(
    @Inject(IAgentConfigurationPort)
    private readonly configuration: IAgentConfigurationPort,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    private readonly profileList: AgentProfileListService,
  ) {}

  async execute(input: SubmitAgentConfigSelectionInput): Promise<AgentConfigSelectionOutcome> {
    const selection = await this.selectionStore.find(input.conversationId);
    if (!selection) {
      throw new Error('No agent configuration selection in progress.');
    }

    if (selection.step === 'profile') {
      return this.submitProfiles(selection, input.input);
    }

    if (selection.targetRoles && input.input.trim() === EXIT_INPUT) {
      return { kind: 'profiles_menu', selection: await this.profileList.open(selection.conversationId) };
    }

    const option = this.pickOption(selection, input.input);
    if (!option) {
      return { kind: 'invalid', selection };
    }

    if (selection.step === 'agent') {
      return this.submitAgent(selection, { id: option.id, name: option.label });
    }

    const agent = selection.selectedAgent;
    if (!agent) {
      throw new Error(`Agent configuration selection at step "${selection.step}" has no agent.`);
    }

    if (selection.selectedModel) {
      return this.configure(selection, agent, selection.selectedModel, option);
    }

    return this.submitModel(selection, agent, { id: option.id, name: option.label });
  }

  private async submitProfiles(
    selection: AgentConfigSelection,
    input: string,
  ): Promise<AgentConfigSelectionOutcome> {
    if (input.trim() === EXIT_INPUT) {
      await this.selectionStore.remove(selection.conversationId);
      return { kind: 'profiles_closed' };
    }

    const chosen = this.pickOptions(selection, input);
    if (!chosen) {
      return { kind: 'invalid', selection };
    }

    const targeted = { ...selection, targetRoles: chosen.map(option => option.id) };
    const agents = toSelectionOptions(this.configuration.listAgents());
    if (agents.length === 1) {
      return this.submitAgent(targeted, { id: agents[0]!.id, name: agents[0]!.label });
    }

    return this.advance({ ...targeted, step: 'agent', options: agents });
  }

  private async submitAgent(
    selection: AgentConfigSelection,
    agent: SelectedValue,
  ): Promise<AgentConfigSelectionOutcome> {
    const models = toSelectionOptions(await this.configuration.listModels(agent.id));
    if (models.length === 0) {
      return this.configure(selection, agent, null, null);
    }

    return this.advance({ ...selection, step: 'model', selectedAgent: agent, options: models });
  }

  private async submitModel(
    selection: AgentConfigSelection,
    agent: SelectedValue,
    model: SelectedValue,
  ): Promise<AgentConfigSelectionOutcome> {
    const efforts = toSelectionOptions(await this.configuration.listEfforts(agent.id, model.id));
    if (efforts.length === 0) {
      return this.configure(selection, agent, model, null);
    }

    return this.advance({ ...selection, step: 'effort', selectedModel: model, options: efforts });
  }

  private async advance(selection: AgentConfigSelection): Promise<AgentConfigSelectionOutcome> {
    await this.selectionStore.save(selection);
    return { kind: 'selection', selection };
  }

  private pickOption(selection: AgentConfigSelection, input: string): SelectionOption | null {
    const trimmed = input.trim();
    if (!OPTION_NUMBER_PATTERN.test(trimmed)) {
      return null;
    }
    const index = Number(trimmed);
    return selection.options.find(option => option.index === index) ?? null;
  }

  private pickOptions(selection: AgentConfigSelection, input: string): SelectionOption[] | null {
    const tokens = [...new Set(input.split(OPTION_SEPARATOR_PATTERN).filter(token => token !== ''))];
    if (tokens.length === 0) {
      return null;
    }
    const chosen = tokens.map(token => this.pickOption(selection, token));
    return chosen.every(option => option !== null) ? chosen : null;
  }

  private async configure(
    selection: AgentConfigSelection,
    agent: SelectedValue,
    model: SelectedValue | null,
    effort: SelectionOption | null,
  ): Promise<AgentConfigSelectionOutcome> {
    const profile = {
      agentId: agent.id,
      agentName: agent.name,
      modelId: model?.id ?? null,
      modelName: model?.name ?? null,
      effortId: effort?.id ?? null,
      effortName: effort?.label ?? null,
    };
    const settings = await this.configuration.saveProfiles(selection.conversationId, selection.targetRoles, profile);

    if (selection.targetRoles) {
      const roleNames = new Map(this.configuration.listRoles().map(({ role, roleName }) => [role, roleName]));
      return {
        kind: 'profiles_updated',
        selection: await this.profileList.open(selection.conversationId),
        updatedRoles: selection.targetRoles.map(role => ({ id: role, name: roleNames.get(role) ?? role })),
        profile,
      };
    }

    await this.selectionStore.remove(selection.conversationId);
    return { kind: 'configured', settings, pendingPrompt: selection.pendingPrompt };
  }
}
