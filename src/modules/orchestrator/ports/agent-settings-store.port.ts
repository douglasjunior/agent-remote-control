import type { AgentSettings } from '../models/agent-settings.model.js';


export interface IAgentSettingsStorePort {
  load(): Promise<AgentSettings | null>;
  save(settings: AgentSettings): Promise<void>;
}

export const IAgentSettingsStorePort = Symbol('IAgentSettingsStorePort');
