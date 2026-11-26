import { Inject, Injectable } from '@nestjs/common';

import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { ConversationSettingsStatus } from '../models/configure-profiles.model.js';
import type { ConversationSquadState, Squad } from '../models/squad.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { ISquadStorePort } from '../ports/squad-store.port.js';
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
    @Inject(ISquadStorePort)
    private readonly squadStore: ISquadStorePort,
  ) {}

  /**
   * The conversation's own settings, else what it would start with: the default squad over the most recent settings,
   * or the most recent settings.
   */
  async current(conversationId: string): Promise<AgentSettings | null> {
    const own = await this.settingsStore.load(conversationId);
    if (own) {
      return own;
    }
    return this.startingSettings(await this.settingsStore.loadMostRecent(), await this.squadStore.findDefault());
  }

  /** Gives a conversation without settings the default squad, else a copy of the most recent settings, when there is either. */
  async ensure(conversationId: string): Promise<ConversationSettingsStatus> {
    if (await this.settingsStore.load(conversationId)) {
      return 'configured';
    }
    const defaultSquad = await this.squadStore.findDefault();
    let status: ConversationSettingsStatus = 'missing';
    await this.settingsStore.update(conversationId, (own, mostRecent) => {
      if (own) {
        status = 'configured';
        return null;
      }
      const starting = this.startingSettings(mostRecent, defaultSquad);
      if (starting) {
        status = defaultSquad ? 'squad' : 'inherited';
        return { ...starting, updatedAt: new Date().toISOString() };
      }
      return null;
    });
    return status;
  }

  async list(conversationId: string): Promise<readonly AgentRoleProfile[]> {
    const settings = await this.current(conversationId);
    return this.agentRegistry.listRoles().map(role => this.roleProfile(role, settings ? resolveProfile(settings, role) : undefined));
  }

  /** The roles a squad sets, in the order of the team, each with whether its agent is installed. */
  listSquadProfiles(squad: Squad): readonly AgentRoleProfile[] {
    return this.agentRegistry.listRoles().filter(role => squad.profiles[role]).map(role => this.roleProfile(role, squad.profiles[role]));
  }

  listRoles(): readonly { readonly role: string; readonly roleName: string }[] {
    return this.agentRegistry.listRoles().map(role => ({ role, roleName: this.agentRegistry.getDisplayName(role) }));
  }

  /** Saves `profile` for the given roles, or for every role when `roles` is omitted, over what the conversation runs with. */
  async save(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings> {
    const defaultSquad = await this.squadStore.findDefault();
    const settings = await this.settingsStore.update(conversationId, (own, mostRecent) => {
      const base = own ?? this.startingSettings(mostRecent, defaultSquad) ?? EMPTY_SETTINGS;
      return {
        ...base,
        profiles: { ...base.profiles, ...profileForAllRoles(roles ?? this.agentRegistry.listRoles(), profile) },
        updatedAt: new Date().toISOString(),
      };
    });
    return settings!;
  }

  /** Copies the squad's profiles over what the conversation runs with, in one change, and records the squad. */
  async applySquad(conversationId: string, squad: Squad): Promise<AgentSettings> {
    const defaultSquad = await this.squadStore.findDefault();
    const settings = await this.settingsStore.update(conversationId, (own, mostRecent) => ({
      ...this.withSquad(own ?? this.startingSettings(mostRecent, defaultSquad) ?? EMPTY_SETTINGS, squad),
      updatedAt: new Date().toISOString(),
    }));
    return settings!;
  }

  /** The squad the conversation runs with, named as it is now, and whether a role left it since. */
  async squadState(conversationId: string): Promise<ConversationSquadState> {
    const settings = await this.current(conversationId);
    if (!settings?.appliedSquad) {
      return { customized: false };
    }
    const squad = await this.squadStore.get(settings.appliedSquad.id);
    if (!squad) {
      return { appliedSquad: settings.appliedSquad, customized: true };
    }
    const customized = Object.entries(squad.profiles).some(([role, profile]) => !this.sameChoice(settings.profiles[role], profile));
    return { appliedSquad: { id: squad.id, name: squad.name }, customized };
  }

  private startingSettings(mostRecent: AgentSettings | null, defaultSquad: Squad | null): AgentSettings | null {
    return defaultSquad ? this.withSquad(mostRecent ?? EMPTY_SETTINGS, defaultSquad) : mostRecent;
  }

  private withSquad(settings: AgentSettings, squad: Squad): AgentSettings {
    return {
      profiles: { ...settings.profiles, ...squad.profiles },
      appliedSquad: { id: squad.id, name: squad.name },
      updatedAt: settings.updatedAt,
    };
  }

  private sameChoice(current: AgentProfileSettings | undefined, squad: AgentProfileSettings): boolean {
    return current?.agentId === squad.agentId && current.modelId === squad.modelId && current.effortId === squad.effortId;
  }

  private roleProfile(role: string, profile: AgentProfileSettings | undefined): AgentRoleProfile {
    return {
      role,
      roleName: this.agentRegistry.getDisplayName(role),
      ...(profile ? { profile, agentAvailable: this.capabilities.isAgentAvailable(profile.agentId) } : {}),
    };
  }
}
