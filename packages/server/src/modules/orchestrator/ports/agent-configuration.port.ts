import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentRoleProfile } from '../models/agent-role-profile.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type {
  ConfigureProfilesInput,
  ConfigureProfilesResult,
  ConversationSettingsStatus,
} from '../models/configure-profiles.model.js';


/** Which agent, model and effort each role uses in a conversation, the lists they are chosen from, and the user's language. */
export interface IAgentConfigurationPort {
  /** The agents whose CLI is installed. */
  listAgents(): readonly AgentOption[];
  getDefaultAgent(): AgentOption;
  /** The agent of the conversation's CEO profile (own or most recent settings), else the default agent. */
  currentAgent(conversationId: string): Promise<AgentOption>;
  listModels(agentId: string): Promise<readonly AgentOption[]>;
  listEfforts(agentId: string, modelId: string): Promise<readonly AgentOption[]>;
  listRoles(): readonly { readonly role: string; readonly roleName: string }[];
  listProfiles(conversationId: string): Promise<readonly AgentRoleProfile[]>;
  /** Whether a message sent now runs: the conversation has settings, or the most recent ones can be inherited. */
  hasSettings(conversationId: string): Promise<boolean>;
  /** Gives a conversation without settings a copy of the most recent ones, when there are any. */
  ensureSettings(conversationId: string): Promise<ConversationSettingsStatus>;
  /** Saves a profile the caller already resolved, for the given roles or every role when `undefined`. */
  saveProfiles(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings>;
  /** Checks the ids against the lists, takes the names from them and saves. */
  configureProfiles(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult>;
  getLanguage(): Promise<string>;
  /** Stores the language as normalized; `undefined` when the input is not a valid language. */
  setLanguage(input: string): Promise<string | undefined>;
}

export const IAgentConfigurationPort = Symbol('IAgentConfigurationPort');
