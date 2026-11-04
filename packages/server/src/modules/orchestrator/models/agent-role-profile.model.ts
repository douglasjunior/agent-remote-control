import type { AgentProfileSettings } from './agent-settings.model.js';


export type AgentRoleProfile = {
  readonly role: string;
  readonly roleName: string;
  /** Absent when no settings exist for the conversation. */
  readonly profile?: AgentProfileSettings;
  /** Whether the profile's agent is installed; absent together with `profile`. */
  readonly agentAvailable?: boolean;
};
