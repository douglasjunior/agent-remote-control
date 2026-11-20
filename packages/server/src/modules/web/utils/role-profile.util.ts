import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';

import type { AgentRoleProfile } from '../../orchestrator/models/agent-role-profile.model.js';


/** A role's profile as the protocol carries it; a stored profile without names shows its ids. */
export function toRoleProfile({ role, roleName, profile, agentAvailable }: AgentRoleProfile): RoleProfile {
  return {
    role,
    roleName,
    ...(profile
      ? {
        agent: { id: profile.agentId, name: profile.agentName, available: agentAvailable ?? false },
        ...(profile.modelId ? { model: { id: profile.modelId, name: profile.modelName ?? profile.modelId } } : {}),
        ...(profile.effortId ? { effort: { id: profile.effortId, name: profile.effortName ?? profile.effortId } } : {}),
      }
      : {}),
  };
}
