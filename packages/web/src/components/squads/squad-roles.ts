import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { Squad } from '@agent-remote-control/protocol/squad';

import type { ConversationView } from '../../conversations/conversations-reducer.js';
import { agentIdentity, TEAM_ROLES } from '../../lib/agent-identity.js';


export type SquadRole = { readonly role: string; readonly roleName: string };

/**
 * The roles a squad can set: those of a conversation the server described, else the team the app knows, plus any
 * role the squad already sets.
 */
export function squadRoles(views: readonly ConversationView[], squad?: Squad): readonly SquadRole[] {
  const described = views.find(view => view.profiles.length > 0)?.profiles;
  const roles: SquadRole[] = described
    ? described.map(({ role, roleName }) => ({ role, roleName }))
    : TEAM_ROLES.map(role => ({ role, roleName: agentIdentity(role).label }));
  const extra = (squad?.profiles ?? []).filter(profile => !roles.some(({ role }) => role === profile.role));
  return [...roles, ...extra.map(({ role, roleName }: RoleProfile) => ({ role, roleName }))];
}
