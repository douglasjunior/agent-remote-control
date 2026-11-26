import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type {
  ConfigureProfilesInput,
  ConfigureProfilesResult,
  ConversationSettingsStatus,
} from '../models/configure-profiles.model.js';
import type {
  ApplySquadResult,
  ConversationSquadState,
  SaveSquadInput,
  SaveSquadResult,
  SquadView,
} from '../models/squad.model.js';
import type { IAgentConfigurationPort } from '../ports/agent-configuration.port.js';
import { resolveProfile, profileForAllRoles } from '../utils/agent-profile.util.js';
import { normalizeUserLanguage } from '../utils/user-language.util.js';

import { StubAgentSettingsStore } from './stub-agent-settings-store.js';


const EMPTY_SETTINGS: AgentSettings = { profiles: {}, updatedAt: '' };

/** In-memory configuration: lists and squads you set, settings in a `StubAgentSettingsStore`, language in a field. */
export class StubAgentConfigurationPort implements IAgentConfigurationPort {
  agents: AgentOption[] = [{ id: 'codex', name: 'Codex' }];
  defaultAgent: AgentOption = { id: 'codex', name: 'Codex' };
  modelsByAgent: Record<string, AgentOption[]> = { codex: [{ id: 'gpt', name: 'GPT', description: 'Fast' }] };
  effortsByModel: Record<string, AgentOption[]> = { gpt: [{ id: 'high', name: 'High' }] };
  unavailableAgentIds = new Set<string>();
  configureResult: ConfigureProfilesResult = { ok: true };
  /** The stored language; `getLanguage()` reads English while it is unset. */
  language: string | undefined = 'English';
  store = new StubAgentSettingsStore();
  squads: SquadView[] = [];
  /** Answered by `saveSquad`; without it the save succeeds with a squad built from the input. */
  saveSquadResult: SaveSquadResult | undefined;
  squadStates = new Map<string, ConversationSquadState>();

  /** Agent ids whose models or efforts were listed, in order. */
  readonly probedAgents: string[] = [];
  readonly configureCalls: ConfigureProfilesInput[] = [];
  readonly languageUpdates: string[] = [];
  readonly savedSquads: SaveSquadInput[] = [];
  readonly appliedSquads: { readonly conversationId: string; readonly squadId: string }[] = [];
  private readonly registry = new AgentRegistryService();

  listAgents(): readonly AgentOption[] {
    return this.agents;
  }

  getDefaultAgent(): AgentOption {
    return this.defaultAgent;
  }

  async currentAgent(conversationId: string): Promise<AgentOption> {
    const profile = resolveProfile((await this.current(conversationId)) ?? EMPTY_SETTINGS, 'CEO');
    return profile ? { id: profile.agentId, name: profile.agentName } : this.defaultAgent;
  }

  async listModels(agentId: string): Promise<readonly AgentOption[]> {
    this.probedAgents.push(agentId);
    return this.modelsByAgent[agentId] ?? [];
  }

  async listEfforts(agentId: string, modelId: string): Promise<readonly AgentOption[]> {
    this.probedAgents.push(agentId);
    return this.effortsByModel[modelId] ?? [];
  }

  listRoles(): readonly { readonly role: string; readonly roleName: string }[] {
    return this.registry.listRoles().map(role => ({ role, roleName: this.registry.getDisplayName(role) }));
  }

  async listProfiles(conversationId: string): Promise<readonly AgentRoleProfile[]> {
    const settings = await this.current(conversationId);
    return this.listRoles().map(({ role, roleName }): AgentRoleProfile => {
      const profile = settings ? resolveProfile(settings, role) : undefined;
      return {
        role,
        roleName,
        ...(profile ? { profile, agentAvailable: !this.unavailableAgentIds.has(profile.agentId) } : {}),
      };
    });
  }

  async hasSettings(conversationId: string): Promise<boolean> {
    return (await this.current(conversationId)) !== null;
  }

  async ensureSettings(conversationId: string): Promise<ConversationSettingsStatus> {
    let status: ConversationSettingsStatus = 'missing';
    await this.store.update(conversationId, (own, mostRecent) => {
      if (own) {
        status = 'configured';
        return null;
      }
      if (mostRecent) {
        status = 'inherited';
        return { ...mostRecent, updatedAt: new Date().toISOString() };
      }
      return null;
    });
    return status;
  }

  async saveProfiles(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings> {
    const settings = await this.store.update(conversationId, (own, mostRecent) => ({
      profiles: { ...(own ?? mostRecent ?? EMPTY_SETTINGS).profiles, ...profileForAllRoles(roles ?? this.registry.listRoles(), profile) },
      updatedAt: new Date().toISOString(),
    }));
    return settings!;
  }

  async configureProfiles(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult> {
    this.configureCalls.push(input);
    if (this.configureResult.ok) {
      await this.saveProfiles(input.conversationId, input.roles, {
        agentId: input.agentId,
        agentName: input.agentId,
        modelId: input.modelId ?? null,
        modelName: input.modelId ?? null,
        effortId: input.effortId ?? null,
        effortName: input.effortId ?? null,
      });
    }
    return this.configureResult;
  }

  async listSquads(): Promise<readonly SquadView[]> {
    return this.squads;
  }

  async saveSquad(input: SaveSquadInput): Promise<SaveSquadResult> {
    this.savedSquads.push(input);
    return this.saveSquadResult ?? {
      ok: true,
      squad: {
        id: input.id ?? `squad-${this.savedSquads.length}`,
        name: input.name,
        isDefault: input.isDefault,
        profiles: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    };
  }

  async deleteSquad(squadId: string): Promise<boolean> {
    const before = this.squads.length;
    this.squads = this.squads.filter(squad => squad.id !== squadId);
    return this.squads.length < before;
  }

  /** Writes each profile of the squad into the conversation and records it as applied, not customized. */
  async applySquad(conversationId: string, squadId: string): Promise<ApplySquadResult> {
    const squad = this.squads.find(candidate => candidate.id === squadId);
    if (!squad) {
      return { ok: false, error: 'Unknown squad' };
    }
    this.appliedSquads.push({ conversationId, squadId });
    const profiles = Object.fromEntries(squad.profiles.flatMap(({ role, profile }) => (profile ? [[role, profile]] : [])));
    await this.store.update(conversationId, (own, mostRecent) => ({
      profiles: { ...(own ?? mostRecent ?? EMPTY_SETTINGS).profiles, ...profiles },
      appliedSquad: { id: squad.id, name: squad.name },
      updatedAt: new Date().toISOString(),
    }));
    this.squadStates.set(conversationId, { appliedSquad: { id: squad.id, name: squad.name }, customized: false });
    return { ok: true };
  }

  async getSquadState(conversationId: string): Promise<ConversationSquadState> {
    return this.squadStates.get(conversationId) ?? { customized: false };
  }

  async getLanguage(): Promise<string> {
    return this.language ?? 'English';
  }

  async getStoredLanguage(): Promise<string | undefined> {
    return this.language;
  }

  async resetLanguage(): Promise<void> {
    this.language = undefined;
  }

  async setLanguage(input: string): Promise<string | undefined> {
    const language = normalizeUserLanguage(input);
    if (language) {
      this.language = language;
      this.languageUpdates.push(language);
    }
    return language;
  }

  private async current(conversationId: string): Promise<AgentSettings | null> {
    return (await this.store.load(conversationId)) ?? (await this.store.loadMostRecent());
  }
}
