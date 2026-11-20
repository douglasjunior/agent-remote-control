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


/**
 * Which agent, model and effort each role uses in a conversation, the lists they are chosen from, the squads that set
 * them in one go, and the user's language.
 */
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
  /** Whether a message sent now runs: the conversation has settings, or the default squad or the most recent settings can be copied. */
  hasSettings(conversationId: string): Promise<boolean>;
  /** Gives a conversation without settings the default squad, else a copy of the most recent settings, when there is either. */
  ensureSettings(conversationId: string): Promise<ConversationSettingsStatus>;
  /** Saves a profile the caller already resolved, for the given roles or every role when `undefined`. */
  saveProfiles(
    conversationId: string,
    roles: readonly string[] | undefined,
    profile: AgentProfileSettings,
  ): Promise<AgentSettings>;
  /** Checks the ids against the lists, takes the names from them and saves. */
  configureProfiles(input: ConfigureProfilesInput): Promise<ConfigureProfilesResult>;
  /** Every squad, by name. */
  listSquads(): Promise<readonly SquadView[]>;
  /** Checks every profile like `configureProfiles`, and the name, unique in any letter case, then saves. */
  saveSquad(input: SaveSquadInput): Promise<SaveSquadResult>;
  /** Resolves to whether the squad existed; conversations that applied it keep their profiles. */
  deleteSquad(squadId: string): Promise<boolean>;
  /** Copies the squad's profiles into the conversation, leaving the roles it does not set as they are. */
  applySquad(conversationId: string, squadId: string): Promise<ApplySquadResult>;
  getSquadState(conversationId: string): Promise<ConversationSquadState>;
  getLanguage(): Promise<string>;
  /** The language stored; `undefined` while none is, and the CEO takes it from the user's first message. */
  getStoredLanguage(): Promise<string | undefined>;
  /** Stores the language as normalized; `undefined` when the input is not a valid language. */
  setLanguage(input: string): Promise<string | undefined>;
  /** Forgets the stored language, so the CEO takes it from the user's next message. */
  resetLanguage(): Promise<void>;
}

export const IAgentConfigurationPort = Symbol('IAgentConfigurationPort');
