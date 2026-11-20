import { Injectable } from '@nestjs/common';

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
import { ApplySquadToConversationUseCase } from '../use-cases/apply-squad-to-conversation.use-case.js';
import { ConfigureAgentProfilesUseCase } from '../use-cases/configure-agent-profiles.use-case.js';
import { DeleteSquadUseCase } from '../use-cases/delete-squad.use-case.js';
import { ListSquadsUseCase } from '../use-cases/list-squads.use-case.js';
import { SaveSquadUseCase } from '../use-cases/save-squad.use-case.js';

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
    private readonly listSquadsUseCase: ListSquadsUseCase,
    private readonly saveSquadUseCase: SaveSquadUseCase,
    private readonly deleteSquadUseCase: DeleteSquadUseCase,
    private readonly applySquadUseCase: ApplySquadToConversationUseCase,
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

  listSquads(): Promise<readonly SquadView[]> {
    return this.listSquadsUseCase.execute();
  }

  saveSquad(input: SaveSquadInput): Promise<SaveSquadResult> {
    return this.saveSquadUseCase.execute(input);
  }

  deleteSquad(squadId: string): Promise<boolean> {
    return this.deleteSquadUseCase.execute(squadId);
  }

  applySquad(conversationId: string, squadId: string): Promise<ApplySquadResult> {
    return this.applySquadUseCase.execute(conversationId, squadId);
  }

  getSquadState(conversationId: string): Promise<ConversationSquadState> {
    return this.profiles.squadState(conversationId);
  }

  getLanguage(): Promise<string> {
    return this.language.get();
  }

  getStoredLanguage(): Promise<string | undefined> {
    return this.language.getStored();
  }

  setLanguage(input: string): Promise<string | undefined> {
    return this.language.set(input);
  }

  resetLanguage(): Promise<void> {
    return this.language.reset();
  }
}
