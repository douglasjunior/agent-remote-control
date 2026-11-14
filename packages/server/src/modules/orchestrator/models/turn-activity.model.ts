import type { AgentActivity } from '../../agent/ports/agent.port.js';


/** A skill an agent read or wrote through a request. */
export type SkillActivity = {
  readonly kind: 'skill';
  readonly id: string;
  readonly action: 'read' | 'write';
  readonly names: readonly string[];
  readonly status: 'completed' | 'failed';
  /** Whether a write created the skill rather than replacing it. */
  readonly created?: boolean;
  readonly error?: string;
};

/** What a channel shows while a turn runs: the agents' activity with the response protocol already read. */
export type TurnActivity =
  | SkillActivity
  | Exclude<AgentActivity, { readonly kind: 'thought' }>
  | {
    readonly kind: 'thought';
    readonly id: string;
    readonly text: string;
    readonly final?: boolean;
    /** The block held only the final response, so the entry it opened is taken back. */
    readonly removed?: boolean;
  };
