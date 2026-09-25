import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';


export interface IAgentConfigSelectionStorePort {
  find(channelId: string, threadId?: string): Promise<AgentConfigSelection | null>;
  save(selection: AgentConfigSelection): Promise<void>;
  remove(channelId: string, threadId?: string): Promise<boolean>;
}

export const IAgentConfigSelectionStorePort = Symbol('IAgentConfigSelectionStorePort');
