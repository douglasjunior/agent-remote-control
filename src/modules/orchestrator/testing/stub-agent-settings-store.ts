import type { AgentSettings } from '../models/agent-settings.model.js';
import type { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';


export class StubAgentSettingsStore implements IAgentSettingsStorePort {
  /** Returned for every conversation that has no entry in `byConversation`. */
  settings: AgentSettings | null = null;
  readonly byConversation = new Map<string, AgentSettings>();
  readonly saved: AgentSettings[] = [];

  async load(conversationId: string): Promise<AgentSettings | null> {
    return this.byConversation.get(conversationId) ?? this.settings;
  }

  async loadMostRecent(): Promise<AgentSettings | null> {
    if (this.byConversation.size === 0) {
      return this.settings;
    }
    const all = Array.from(this.byConversation.values());
    return all.reduce((latest, current) =>
      current.updatedAt > latest.updatedAt ? current : latest);
  }

  async save(conversationId: string, settings: AgentSettings): Promise<void> {
    this.saved.push(settings);
    this.settings = settings;
    this.byConversation.set(conversationId, settings);
  }
}
