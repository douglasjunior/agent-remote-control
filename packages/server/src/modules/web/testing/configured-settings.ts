import type { AgentSettings } from '../../orchestrator/models/agent-settings.model.js';
import { buildStubProfile } from '../../orchestrator/testing/stub-agent-settings-store.js';


/** Settings for a conversation whose messages are allowed to run. */
export function configuredSettings(): AgentSettings {
  return { profiles: { CEO: buildStubProfile('codex', { agentName: 'Codex' }) }, updatedAt: '2026-01-01T00:00:00Z' };
}
