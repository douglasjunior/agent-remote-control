import type { AgentSettings } from '../models/agent-settings.model.js';


/**
 * Receives the conversation's own settings and the most recently updated ones of any conversation, and returns the
 * settings to store for the conversation, or `null` to leave them as they are.
 */
export type AgentSettingsChange = (own: AgentSettings | null, mostRecent: AgentSettings | null) => AgentSettings | null;

export interface IAgentSettingsStorePort {
  load(conversationId: string): Promise<AgentSettings | null>;
  loadMostRecent(): Promise<AgentSettings | null>;
  /**
   * Applies `change` to the stored settings as one step, so concurrent changes to different roles all stay.
   * Resolves to the conversation's settings afterwards.
   */
  update(conversationId: string, change: AgentSettingsChange): Promise<AgentSettings | null>;
}

export const IAgentSettingsStorePort = Symbol('IAgentSettingsStorePort');
