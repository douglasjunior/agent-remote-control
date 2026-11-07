import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';


export interface IAgentConfigSelectionStorePort {
  find(conversationId: string): Promise<AgentConfigSelection | null>;
  save(selection: AgentConfigSelection): Promise<void>;
  remove(conversationId: string): Promise<boolean>;
}

export const IAgentConfigSelectionStorePort = Symbol('IAgentConfigSelectionStorePort');
