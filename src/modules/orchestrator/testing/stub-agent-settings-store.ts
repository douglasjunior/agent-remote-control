import type { AgentSettings } from '../models/agent-settings.model.js';
import type { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';


export class StubAgentSettingsStore implements IAgentSettingsStorePort {
  settings: AgentSettings | null = null;
  readonly saved: AgentSettings[] = [];

  async load(): Promise<AgentSettings | null> {
    return this.settings;
  }

  async save(settings: AgentSettings): Promise<void> {
    this.saved.push(settings);
    this.settings = settings;
  }
}
