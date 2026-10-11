import type { AgentSettings } from '../models/agent-settings.model.js';


export interface IAgentSettingsStorePort {
  load(conversationId: string): Promise<AgentSettings | null>;
  loadMostRecent(): Promise<AgentSettings | null>;
  save(conversationId: string, settings: AgentSettings): Promise<void>;
}

export const IAgentSettingsStorePort = Symbol('IAgentSettingsStorePort');
