import type { AgentActivity } from '../../agent/ports/agent.port.js';


/** What a channel shows while a turn runs: the agents' activity with the response protocol already read. */
export type TurnActivity =
  | Exclude<AgentActivity, { readonly kind: 'thought' }>
  | {
    readonly kind: 'thought';
    readonly id: string;
    readonly text: string;
    readonly final?: boolean;
    /** The block held only the final response, so the entry it opened is taken back. */
    readonly removed?: boolean;
  };
