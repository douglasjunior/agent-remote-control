import type { IAgentPort } from '../../agent/ports/agent.port.js';

import type { ActiveTurn } from './active-turn.model.js';
import type { TurnAgentInfo } from './turn-agent-info.model.js';


export interface ActiveDelegation {
  /** The id that holds its artifact on the board. */
  readonly delegationId: string;
  readonly role: string;
  readonly roleName: string;
  readonly agentInfo: TurnAgentInfo;
  readonly projectName: string | null;
  /** The artifact the agent holds while it runs. */
  readonly artifactId: string | null;
  readonly summary: string;
  readonly taskSpec: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly agentPort: IAgentPort;
  readonly turn: ActiveTurn;
  steer(newSpec: string): Promise<boolean>;
  /** Ends the work before it finishes, without ending the turn: the CEO receives `reason` as the agent's result. */
  stop(reason: string): Promise<void>;
}
