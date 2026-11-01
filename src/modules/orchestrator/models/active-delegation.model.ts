import type { IAgentPort } from '../../agent/ports/agent.port.js';

import type { ActiveTurn } from './active-turn.model.js';
import type { TurnAgentInfo } from './turn-agent-info.model.js';


export interface ActiveDelegation {
  readonly role: string;
  readonly roleName: string;
  readonly agentInfo: TurnAgentInfo;
  readonly projectName: string | null;
  readonly taskSpec: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly agentPort: IAgentPort;
  readonly turn: ActiveTurn;
  steer(newSpec: string): Promise<boolean>;
}
