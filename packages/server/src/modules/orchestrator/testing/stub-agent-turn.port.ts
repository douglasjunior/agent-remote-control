import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { AudioTranscriptionResult } from '../models/audio-transcription.model.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import type { IAgentTurnPort } from '../ports/agent-turn.port.js';


export class StubAgentTurnPort implements IAgentTurnPort {
  turnResult: TurnResult = { response: 'done', status: 'completed' };
  /** Runs while the turn executes, before it resolves; use it to emit callbacks. */
  turnBehavior?: (request: TurnRequest) => void | Promise<void>;
  turnError?: Error;
  cancelResult = true;
  /** Overrides the default pass-through transcription. */
  transcription?: AudioTranscriptionResult;
  shellEnabled = true;
  shellResult: ShellCommandResult = { command: '', output: '', exitCode: 0, truncated: false, timedOut: false, cancelled: false };
  throwOnShell = false;
  quotaReports: readonly AgentQuotaReport[] = [];
  throwOnQuota = false;
  throwOnCancel = false;

  readonly turnRequests: TurnRequest[] = [];
  readonly cancelledConversations: string[] = [];
  readonly transcribed: { prompt: string; attachments?: readonly TurnAttachment[] }[] = [];
  readonly shellCalls: { conversationId: string; command: string }[] = [];

  get lastRequest(): TurnRequest | undefined {
    return this.turnRequests.at(-1);
  }

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    this.turnRequests.push(request);
    await this.turnBehavior?.(request);
    if (this.turnError) {
      throw this.turnError;
    }
    return this.turnResult;
  }

  async cancelTurn(conversationId: string): Promise<boolean> {
    if (this.throwOnCancel) {
      throw new Error('Cancel turn failed');
    }
    this.cancelledConversations.push(conversationId);
    return this.cancelResult;
  }

  async transcribeAudio(input: { prompt: string; attachments?: readonly TurnAttachment[] }): Promise<AudioTranscriptionResult> {
    this.transcribed.push(input);
    return this.transcription ?? { prompt: input.prompt, attachments: input.attachments ?? [], transcripts: [], warnings: [] };
  }

  isShellCommandEnabled(): boolean {
    return this.shellEnabled;
  }

  async runShellCommand(conversationId: string, command: string): Promise<ShellCommandResult> {
    this.shellCalls.push({ conversationId, command });
    if (this.throwOnShell) {
      throw new Error('shell down');
    }
    return { ...this.shellResult, command };
  }

  async getQuota(): Promise<readonly AgentQuotaReport[]> {
    if (this.throwOnQuota) {
      throw new Error('quota down');
    }
    return this.quotaReports;
  }
}
