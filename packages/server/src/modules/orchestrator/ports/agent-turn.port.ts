import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { InterruptedWork } from '../models/open-work.model.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { RestoredWorkAnswers } from '../models/user-question.model.js';


/**
 * What a channel asks of the agents in a conversation: run a turn, stop it, run a command, read the usage.
 * A channel fetches the files of a message itself and hands them over as `TurnRequest.attachments`; the
 * turn turns audio among them into text before any agent runs.
 */
export interface IAgentTurnPort {
  executeTurn(request: TurnRequest): Promise<TurnResult>;
  /** The work a restart stopped in this conversation while it ran, which does not depend on an answer from the user. */
  listInterruptedWork(conversationId: string): readonly InterruptedWork[];
  /** Runs interrupted work to its end and hands the result to the CEO. `prompt` is ignored. */
  resumeWork(workId: string, request: TurnRequest): Promise<TurnResult>;
  /** Hands the answers to the agent that asked before a restart, which carries on like any agent that gets its answers. `prompt` is ignored. */
  deliverAnswers(answers: RestoredWorkAnswers, request: TurnRequest): Promise<TurnResult>;
  /** Returns whether there was a turn or a pending question to cancel. */
  cancelTurn(conversationId: string): Promise<boolean>;
  isShellCommandEnabled(): boolean;
  runShellCommand(conversationId: string, command: string): Promise<ShellCommandResult>;
  getQuota(): Promise<readonly AgentQuotaReport[]>;
}

export const IAgentTurnPort = Symbol('IAgentTurnPort');
