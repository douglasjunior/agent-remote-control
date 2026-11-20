import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { AgentSettingsChange, IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';


export function buildStubSettings(
  profiles: Record<string, AgentProfileSettings>,
  updatedAt = '2026-01-01T00:00:00Z',
): AgentSettings {
  return { profiles, updatedAt };
}

export function buildStubProfile(
  agentId: string,
  overrides?: Partial<AgentProfileSettings>,
): AgentProfileSettings {
  return {
    agentId,
    agentName: agentId,
    modelId: null,
    modelName: null,
    effortId: null,
    effortName: null,
    ...overrides,
  };
}

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

  async update(conversationId: string, change: AgentSettingsChange): Promise<AgentSettings | null> {
    const own = await this.load(conversationId);
    const updated = change(own, await this.loadMostRecent());
    if (!updated) {
      return own;
    }
    this.saved.push(updated);
    this.settings = updated;
    this.byConversation.set(conversationId, updated);
    return updated;
  }
}
