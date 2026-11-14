/** What a role learns about a skill before reading it: its name and when to use it. */
export type AgentSkillSummary = {
  readonly name: string;
  readonly description: string;
};

/** Detailed know-how of a role, read on demand so the system prompt stays small. */
export type AgentSkill = AgentSkillSummary & {
  readonly content: string;
};

/** A skill as a role that writes skills sees it: who reads it and whether it ships with the server. */
export type AgentSkillListing = AgentSkillSummary & {
  readonly roles: readonly string[];
  readonly builtIn: boolean;
};

/** A skill written from a conversation; it replaces the user skill of the same name. */
export type AgentSkillInput = AgentSkill & {
  readonly roles: readonly string[];
};

export type AgentSkillWriteResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly error: string };
