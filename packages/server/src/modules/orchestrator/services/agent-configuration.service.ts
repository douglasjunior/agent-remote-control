import { Injectable } from '@nestjs/common';

import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type {
  ConfigureProfilesInput,
  ConfigureProfilesResult,
  ConversationSettingsStatus,
} from '../models/configure-profiles.model.js';
import type { IAgentConfigurationPort } from '../ports/agent-configuration.port.js';
import { ConfigureAgentProfilesUseCase } from '../use-cases/configure-agent-profiles.use-case.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentProfilesService } from './agent-profiles.service.js';
import { UserLanguageService } from './user-language.service.js';


@Injectable()
export class AgentConfigurationService implements IAgentConfigurationPort {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    private readonly profiles: AgentProfilesService,
    private readonly language: UserLanguageService,
    private readonly configureProfilesUseCase: ConfigureAgentProfilesUseCase,
  ) {}

  listAgents(): readonly AgentOption[] {
    return this.capabilities.listAgentOptions();
  }

  getDefaultAgent(): AgentOption {
    return this.capabilities.resolveAgent(null);
  }

  async currentAgent(conversationId: string): Promise<AgentOption> {
    return this.capabilities.resolveAgent(await this.profiles.current(conversationId));
  }

  listModels(agentId: string): Promise<readonly AgentOption[]> {
    return this.capabilities.listModelOptions(agentId);
  }

  listEfforts(agentId: string, modelId: string): Promise<readonly AgentOption[]> {
    return this.capabilities.listEffortOptions(agentId, modelId);
  }

  listRoles(): readonly { readonly role: string; readonly roleName: string }[] {
    return this.profiles.listRoles();
  }

  listProfiles(conversationId: string): Promise<readonly AgentRoleProfile[]> {
    return this.profiles.list(conversationId);
  }

  async hasSettings(conversationId: string): Promise<boolean> {
    return (await this.profiles.current(conversationId)) !== null;
  }

  ensureSettings(conversationId: string): Promise<ConversationSettingsStatus> {
    return this.profiles.ensure(conversationId);
  }

  saveProfiles(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings> {
    return this.profiles.save(conversationId, roles, profile);
  }

  configureProfiles(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult> {
    return this.configureProfilesUseCase.execute(input);
  }

  getLanguage(): Promise<string> {
    return this.language.get();
  }

  setLanguage(input: string): Promise<string | undefined> {
    return this.language.set(input);
  }
}
