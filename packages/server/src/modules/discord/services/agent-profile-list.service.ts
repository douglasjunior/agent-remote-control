import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { AgentConfigSelection, SelectionOption } from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';


const UNSET_VALUE_LABEL = 'default';
const NOT_INSTALLED_SUFFIX = ' (not installed)';

@Injectable()
export class AgentProfileListService {
  constructor(
    @Inject(IAgentConfigurationPort)
    private readonly configuration: IAgentConfigurationPort,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
  ) {}

  /** Saves and returns a fresh profile step listing every role with its current configuration. */
  async open(conversationId: string): Promise<AgentConfigSelection> {
    let defaultAgentName: string | undefined;

    const options = (await this.configuration.listProfiles(conversationId)).map(
      ({ role, roleName, profile, agentAvailable }, position): SelectionOption => {
        const agentName = profile
          ? `${profile.agentName}${agentAvailable ? '' : NOT_INSTALLED_SUFFIX}`
          : (defaultAgentName ??= this.configuration.getDefaultAgent().name);
        return {
          index: position + 1,
          id: role,
          label: roleName,
          description: [agentName, profile?.modelName ?? UNSET_VALUE_LABEL, profile?.effortName ?? UNSET_VALUE_LABEL].join(' - '),
        };
      },
    );

    const selection: AgentConfigSelection = { conversationId, step: 'profile', options };
    await this.selectionStore.save(selection);
    return selection;
  }
}
