import { Inject, Injectable } from '@nestjs/common';

import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { ConversationSettingsStatus } from '../models/configure-profiles.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { profileForAllRoles, resolveProfile } from '../utils/agent-profile.util.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';


const EMPTY_SETTINGS: AgentSettings = { profiles: {}, updatedAt: '' };

/** The agent, model and effort each role uses in a conversation. */
@Injectable()
export class AgentProfilesService {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  /** The conversation's own settings, else the most recently saved ones. */
  async current(conversationId: string): Promise<AgentSettings | null> {
    return (await this.settingsStore.load(conversationId)) ?? (await this.settingsStore.loadMostRecent());
  }

  /** Gives a conversation without settings a copy of the most recent ones, when there are any. */
  async ensure(conversationId: string): Promise<ConversationSettingsStatus> {
    if (await this.settingsStore.load(conversationId)) {
      return 'configured';
    }
    const mostRecent = await this.settingsStore.loadMostRecent();
    if (!mostRecent) {
      return 'missing';
    }
    await this.settingsStore.save(conversationId, { ...mostRecent, updatedAt: new Date().toISOString() });
    return 'inherited';
  }

  async list(conversationId: string): Promise<readonly AgentRoleProfile[]> {
    const settings = await this.current(conversationId);
    return this.agentRegistry.listRoles().map((role): AgentRoleProfile => {
      const profile = settings ? resolveProfile(settings, role) : undefined;
      return {
        role,
        roleName: this.agentRegistry.getDisplayName(role),
        ...(profile ? { profile, agentAvailable: this.capabilities.isAgentAvailable(profile.agentId) } : {}),
      };
    });
  }

  listRoles(): readonly { readonly role: string; readonly roleName: string }[] {
    return this.agentRegistry.listRoles().map(role => ({ role, roleName: this.agentRegistry.getDisplayName(role) }));
  }

  /** Saves `profile` for the given roles, or for every role when `roles` is omitted. */
  async save(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings> {
    const current = (await this.current(conversationId)) ?? EMPTY_SETTINGS;
    const settings = this.withProfiles(current, roles ?? this.agentRegistry.listRoles(), profile);
    await this.settingsStore.save(conversationId, settings);
    return settings;
  }

  private withProfiles(settings: AgentSettings, roles: readonly string[], profile: AgentProfileSettings): AgentSettings {
    return {
      profiles: { ...settings.profiles, ...profileForAllRoles(roles, profile) },
      updatedAt: new Date().toISOString(),
    };
  }
}
