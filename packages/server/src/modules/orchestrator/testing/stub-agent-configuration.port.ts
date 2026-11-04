import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type {
  ConfigureProfilesInput,
  ConfigureProfilesResult,
  ConversationSettingsStatus,
} from '../models/configure-profiles.model.js';
import type { IAgentConfigurationPort } from '../ports/agent-configuration.port.js';
import { resolveProfile, withProfiles } from '../utils/agent-profile.util.js';
import { normalizeUserLanguage } from '../utils/user-language.util.js';

import { StubAgentSettingsStore } from './stub-agent-settings-store.js';


const EMPTY_SETTINGS: AgentSettings = { profiles: {}, updatedAt: '' };

/** In-memory configuration: lists you set, settings in a `StubAgentSettingsStore`, language in a field. */
export class StubAgentConfigurationPort implements IAgentConfigurationPort {
  agents: AgentOption[] = [{ id: 'codex', name: 'Codex' }];
  defaultAgent: AgentOption = { id: 'codex', name: 'Codex' };
  modelsByAgent: Record<string, AgentOption[]> = { codex: [{ id: 'gpt', name: 'GPT', description: 'Fast' }] };
  effortsByModel: Record<string, AgentOption[]> = { gpt: [{ id: 'high', name: 'High' }] };
  unavailableAgentIds = new Set<string>();
  configureResult: ConfigureProfilesResult = { ok: true };
  language = 'English';
  store = new StubAgentSettingsStore();

  /** Agent ids whose models or efforts were listed, in order. */
  readonly probedAgents: string[] = [];
  readonly configureCalls: ConfigureProfilesInput[] = [];
  readonly languageUpdates: string[] = [];
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
    if (await this.store.load(conversationId)) {
      return 'configured';
    }
    const mostRecent = await this.store.loadMostRecent();
    if (!mostRecent) {
      return 'missing';
    }
    await this.store.save(conversationId, { ...mostRecent, updatedAt: new Date().toISOString() });
    return 'inherited';
  }

  async saveProfiles(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings> {
    const settings = withProfiles((await this.current(conversationId)) ?? EMPTY_SETTINGS, roles ?? this.registry.listRoles(), profile);
    await this.store.save(conversationId, settings);
    return settings;
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

  async getLanguage(): Promise<string> {
    return this.language;
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
