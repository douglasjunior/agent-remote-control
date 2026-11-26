import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { AppliedSquad } from '@agent-remote-control/protocol/squad';


export type ConversationProfiles = {
  /** Whether a message sent now runs: the conversation has settings, or can take the default squad or the most recent ones. */
  readonly configured: boolean;
  readonly profiles: readonly RoleProfile[];
  readonly appliedSquad?: AppliedSquad;
  readonly customized: boolean;
};
