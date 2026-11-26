import type { AgentRoleProfile } from './agent-role-profile.model.js';
import type { AgentProfileSettings, AppliedSquad } from './agent-settings.model.js';


/** A saved set of role profiles, copied into a conversation in one go. */
export type Squad = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Applied to every conversation that starts without settings; at most one squad is the default. */
  readonly isDefault: boolean;
  /** Only the roles the squad sets; applying it leaves the other roles of a conversation as they are. */
  readonly profiles: Readonly<Record<string, AgentProfileSettings>>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** A squad as the channels list it: its profiles in role order, each with whether its agent is installed. */
export type SquadView = Omit<Squad, 'profiles'> & {
  readonly profiles: readonly AgentRoleProfile[];
};

/** The ids of a profile as the user chose them; the names come from the lists they were chosen from. */
export type AgentProfileChoice = {
  readonly agentId: string;
  readonly modelId?: string;
  readonly effortId?: string;
};

export type SaveSquadInput = {
  /** Creates a squad when omitted. */
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly profiles: Readonly<Record<string, AgentProfileChoice>>;
};

export type SaveSquadResult = { readonly ok: true; readonly squad: Squad } | { readonly ok: false; readonly error: string };

export type ApplySquadResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The squad a conversation applied last, and whether its profiles still match it. */
export type ConversationSquadState = {
  readonly appliedSquad?: AppliedSquad;
  /** A role differs from the squad as it is saved now, or the squad was deleted; `false` without an applied squad. */
  readonly customized: boolean;
};
