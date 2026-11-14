import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';


/** What a role runs on, as "agent · model · effort". */
export function profileSummary(profile: RoleProfile): string {
  return profile.agent
    ? [profile.agent.name, profile.model?.name, profile.effort?.name].filter(Boolean).join(' · ')
    : 'Not configured';
}
