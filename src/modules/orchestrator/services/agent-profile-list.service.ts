import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentConfigSelection,
  SelectionOption,
} from '../models/agent-config-selection.model.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { resolveProfile } from '../utils/agent-profile.util.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';


const UNSET_VALUE_LABEL = 'default';
const NOT_INSTALLED_SUFFIX = ' (not installed)';

@Injectable()
export class AgentProfileListService {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  /** Saves and returns a fresh profile step listing every role with its current configuration. */
  async open(conversationId: string): Promise<AgentConfigSelection> {
    const settings = (await this.settingsStore.load(conversationId))
      ?? (await this.settingsStore.loadMostRecent());
    const defaultAgentName = this.capabilities.resolveAgent(null).name;

    const options = this.agentRegistry.listRoles().map((role, position): SelectionOption => {
      const profile = settings ? resolveProfile(settings, role) : undefined;
      const description = [
        profile ? this.describeAgent(profile) : defaultAgentName,
        profile?.modelName ?? UNSET_VALUE_LABEL,
        profile?.effortName ?? UNSET_VALUE_LABEL,
      ].join(' - ');
      return {
        index: position + 1,
        id: role,
        label: this.agentRegistry.getDisplayName(role),
        description,
      };
    });

    const selection: AgentConfigSelection = { conversationId, step: 'profile', options };
    await this.selectionStore.save(selection);
    return selection;
  }

  private describeAgent(profile: AgentProfileSettings): string {
    return this.capabilities.isAgentAvailable(profile.agentId)
      ? profile.agentName
      : `${profile.agentName}${NOT_INSTALLED_SUFFIX}`;
  }
}
