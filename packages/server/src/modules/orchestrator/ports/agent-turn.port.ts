import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';


/**
 * What a channel asks of the agents in a conversation: run a turn, stop it, run a command, read the usage.
 * A channel fetches the files of a message itself and hands them over as `TurnRequest.attachments`; the
 * turn turns audio among them into text before any agent runs.
 */
export interface IAgentTurnPort {
  executeTurn(request: TurnRequest): Promise<TurnResult>;
  /** Returns whether there was a turn or a pending question to cancel. */
  cancelTurn(conversationId: string): Promise<boolean>;
  isShellCommandEnabled(): boolean;
  runShellCommand(conversationId: string, command: string): Promise<ShellCommandResult>;
  getQuota(): Promise<readonly AgentQuotaReport[]>;
}

export const IAgentTurnPort = Symbol('IAgentTurnPort');
