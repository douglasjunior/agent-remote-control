import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { AudioTranscriptionResult } from '../models/audio-transcription.model.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';


/** What a channel asks of the agents in a conversation: run a turn, stop it, run a command, read the usage. */
export interface IAgentTurnPort {
  executeTurn(request: TurnRequest): Promise<TurnResult>;
  /** Returns whether there was a turn or a pending question to cancel. */
  cancelTurn(conversationId: string): Promise<boolean>;
  /** Replaces audio attachments with their transcripts; text and other attachments pass through. */
  transcribeAudio(input: {
    readonly prompt: string;
    readonly attachments?: readonly TurnAttachment[];
  }): Promise<AudioTranscriptionResult>;
  isShellCommandEnabled(): boolean;
  runShellCommand(conversationId: string, command: string): Promise<ShellCommandResult>;
  getQuota(): Promise<readonly AgentQuotaReport[]>;
}

export const IAgentTurnPort = Symbol('IAgentTurnPort');
