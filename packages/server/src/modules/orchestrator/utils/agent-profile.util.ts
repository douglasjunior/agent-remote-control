import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';


const FALLBACK_ROLE = 'CEO';

export function resolveProfile(
  settings: AgentSettings,
  role: string,
): AgentProfileSettings | undefined {
  return settings.profiles[role] ?? settings.profiles[FALLBACK_ROLE];
}

export function profileForAllRoles(
  roles: readonly string[],
  profile: AgentProfileSettings,
): Record<string, AgentProfileSettings> {
  return Object.fromEntries(roles.map(role => [role, profile]));
}

export function withProfiles(
  settings: AgentSettings,
  roles: readonly string[],
  profile: AgentProfileSettings,
): AgentSettings {
  return {
    profiles: { ...settings.profiles, ...profileForAllRoles(roles, profile) },
    updatedAt: new Date().toISOString(),
  };
}
