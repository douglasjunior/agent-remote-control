import type {
  SessionNotification,
  ToolCallContent,
} from '@agentclientprotocol/sdk';

import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../constants/final-response.constant.js';
import type { AgentActivity, AgentToolStatus } from '../ports/agent.port.js';


type ToolActivity = AgentActivity & { kind: 'tool' };

const NARRATION_IDLE_MS = 3_000;
const BLOCK_ID_SEPARATOR = '#';
const THOUGHT_ID_SUFFIX = ':thought';
const CODE_FENCE_PATTERN = /^`{3,}/;
const MAX_SUMMARY_LINES = 5;
const SUMMARY_TRUNCATION_MARKER = '...';

type MessageState = {
  buffer: string;
  blockStart: number;
  closedBlocks: number;
  lastChunkAt: number;
  isThought: boolean;
  isFinal: boolean;
};

export type ParsedToolCallFields = {
  readonly toolCallId: string;
  readonly title?: string;
  readonly status?: AgentToolStatus;
  readonly content?: readonly ToolCallContent[] | null;
};

export type ParsedAgentMessageChunk = {
  readonly text: string;
  readonly messageId?: string;
  readonly isThought?: boolean;
};

export function extractToolCallFields(
  update: SessionNotification,
): ParsedToolCallFields | null {
  const { update: payload } = update;

  if (
    payload.sessionUpdate !== 'tool_call'
    && payload.sessionUpdate !== 'tool_call_update'
  ) {
    return null;
  }

  return {
    toolCallId: payload.toolCallId,
    title: payload.title ?? undefined,
    status: payload.status ?? undefined,
    content: payload.content,
  };
}

export function extractAgentTextChunk(
  update: SessionNotification,
): ParsedAgentMessageChunk | null {
  const { update: payload } = update;

  if (
    payload.sessionUpdate !== 'agent_message_chunk'
    && payload.sessionUpdate !== 'agent_thought_chunk'
  ) {
    return null;
  }

  if (payload.content.type !== 'text') {
    return null;
  }

  return {
    text: payload.content.text,
    messageId: payload.messageId ?? undefined,
    isThought: payload.sessionUpdate === 'agent_thought_chunk',
  };
}

type EnvelopeParts = {
  readonly prose: string;
  readonly answers: readonly string[];
};

/**
 * Splits a message into the prose around `<final_response>` envelopes and the envelope contents.
 * An envelope still missing its closing tag runs to the end of the text, since it is still streaming.
 */
export function splitFinalResponse(text: string): EnvelopeParts {
  let prose = '';
  const answers: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf(FINAL_RESPONSE_OPEN);
    if (open < 0) {
      prose += rest;
      break;
    }

    prose += rest.slice(0, open);
    const contentStart = open + FINAL_RESPONSE_OPEN.length;
    const close = rest.indexOf(FINAL_RESPONSE_CLOSE, contentStart);
    if (close < 0) {
      answers.push(rest.slice(contentStart));
      break;
    }

    answers.push(rest.slice(contentStart, close));
    rest = rest.slice(close + FINAL_RESPONSE_CLOSE.length);
  }

  return { prose, answers };
}

/** Drops envelope tags left without a counterpart so they never reach the user. */
function stripEnvelopeTags(text: string): string {
  return text.split(FINAL_RESPONSE_OPEN).join('').split(FINAL_RESPONSE_CLOSE).join('');
}

function meaningfulLines(text: string): string[] {
  const lines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (line.length === 0 || CODE_FENCE_PATTERN.test(line)) {
      continue;
    }

    if (lines.length >= MAX_SUMMARY_LINES) {
      lines.push(SUMMARY_TRUNCATION_MARKER);
      break;
    }

    lines.push(line);
  }

  return lines;
}

export function extractToolDetails(
  content: readonly ToolCallContent[] | null | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (item.type !== 'content' || item.content.type !== 'text') {
      continue;
    }

    const text = item.content.text.trim();
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

export function extractToolResultSummary(
  content: readonly ToolCallContent[] | null | undefined,
): string | undefined {
  if (!content) {
    return undefined;
  }

  for (const item of content) {
    if (item.type !== 'content' || item.content.type !== 'text') {
      continue;
    }

    const lines = meaningfulLines(item.content.text);

    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  return undefined;
}

export class AgentStreamDemux {
  private readonly messages = new Map<string, MessageState>();
  private readonly toolState = new Map<string, ToolActivity>();
  private fallbackId: string | null = null;
  private syntheticSeq = 0;
  private lastText = '';

  constructor(
    private readonly emit: (activity: AgentActivity) => void,
    private readonly idleMs: number = NARRATION_IDLE_MS,
  ) {}

  get lastAgentMessage(): string {
    return this.lastText;
  }

  handle(update: SessionNotification): void {
    const chunk = extractAgentTextChunk(update);

    if (chunk) {
      const id = this.resolveMessageId(chunk);
      this.closeIdleBlocks(id);
      this.handleNarration(chunk, id);
      return;
    }

    const toolFields = extractToolCallFields(update);

    if (!toolFields) {
      return;
    }

    if (update.update.sessionUpdate === 'tool_call') {
      this.fallbackId = null;
      this.closeIdleBlocks();
    }

    this.dispatchTool(toolFields);
  }

  takeFinalText(): string {
    const finalText = this.finalResponse() ?? this.joinMessages();
    this.resetTurn();
    return finalText;
  }

  private finalResponse(): string | null {
    const finalStates = [...this.messages.values()].filter(state => state.isFinal);
    if (finalStates.length === 0) {
      return null;
    }
    return finalStates
      .flatMap(state => splitFinalResponse(state.buffer).answers)
      .map(answer => answer.trim())
      .filter(answer => answer.length > 0)
      .join('\n\n');
  }

  private joinMessages(): string {
    const texts: string[] = [];
    for (const state of this.messages.values()) {
      if (state.isThought) {
        continue;
      }
      const text = stripEnvelopeTags(state.buffer).trim();
      if (text.length > 0) {
        texts.push(text);
      }
    }
    return texts.join('\n\n');
  }

  reset(): void {
    this.resetTurn();
    this.lastText = '';
    this.toolState.clear();
  }

  private resetTurn(): void {
    this.messages.clear();
    this.fallbackId = null;
  }

  private handleNarration(chunk: ParsedAgentMessageChunk, id: string): void {
    const state = this.messages.get(id) ?? {
      buffer: '',
      blockStart: 0,
      closedBlocks: 0,
      lastChunkAt: 0,
      isThought: Boolean(chunk.isThought),
      isFinal: false,
    };
    state.buffer += chunk.text;
    state.lastChunkAt = Date.now();
    this.messages.set(id, state);

    if (state.isFinal || (!state.isThought && state.buffer.includes(FINAL_RESPONSE_OPEN))) {
      this.handleFinalResponse(id, state);
      return;
    }

    const trimmed = chunk.text.trim();
    if (trimmed.length > 0) {
      this.lastText = trimmed;
    }

    const text = this.blockText(state);
    if (text.length > 0) {
      this.emit({ kind: 'thought', id: this.blockId(id, state), text });
    }
  }

  /**
   * The envelope carries the turn answer, which reaches the caller as the final block. Its first
   * sighting settles the feed entry to the prose before it, or removes the entry when there is none.
   */
  private handleFinalResponse(id: string, state: MessageState): void {
    const answer = splitFinalResponse(state.buffer).answers.join('\n\n').trim();
    if (answer.length > 0) {
      this.lastText = answer;
    }

    if (state.isFinal) {
      return;
    }
    state.isFinal = true;

    const blockId = this.blockId(id, state);
    const prose = this.blockText(state);
    this.emit(
      prose.length > 0
        ? { kind: 'thought', id: blockId, text: prose, final: true }
        : { kind: 'thought', id: blockId, text: '', removed: true },
    );
  }

  private closeIdleBlocks(exceptId?: string): void {
    const now = Date.now();

    for (const [id, state] of this.messages) {
      if (id !== exceptId && now - state.lastChunkAt >= this.idleMs) {
        this.finalizeNarration(id);
      }
    }
  }

  private finalizeNarration(id: string): void {
    const state = this.messages.get(id);

    /* v8 ignore next */
    if (!state || state.isFinal) {
      return;
    }

    const text = this.blockText(state);
    if (text.length === 0) {
      return;
    }

    this.emit({
      kind: 'thought',
      id: this.blockId(id, state),
      text,
      final: true,
    });
    state.blockStart = state.buffer.length;
    state.closedBlocks += 1;
  }

  private blockId(id: string, state: MessageState): string {
    return state.closedBlocks === 0
      ? id
      : `${id}${BLOCK_ID_SEPARATOR}${state.closedBlocks}`;
  }

  private blockText(state: MessageState): string {
    return splitFinalResponse(state.buffer.slice(state.blockStart)).prose.trim();
  }

  private resolveMessageId(chunk: ParsedAgentMessageChunk): string {
    // Thought and message chunks may share an id; keeping them apart stops one kind from taking over the other's buffer.
    const suffix = chunk.isThought ? THOUGHT_ID_SUFFIX : '';

    if (chunk.messageId !== undefined) {
      return `${chunk.messageId}${suffix}`;
    }

    this.fallbackId ??= `synthetic:${this.syntheticSeq++}`;

    return `${this.fallbackId}${suffix}`;
  }

  private dispatchTool(toolFields: ParsedToolCallFields): void {
    const previous = this.toolState.get(toolFields.toolCallId);
    const details =
      extractToolDetails(toolFields.content) ?? previous?.details;
    const result =
      extractToolResultSummary(toolFields.content) ?? previous?.result;
    const merged: ToolActivity = {
      kind: 'tool',
      toolCallId: toolFields.toolCallId,
      title: toolFields.title ?? previous?.title ?? toolFields.toolCallId,
      status: toolFields.status ?? previous?.status ?? 'pending',
      result,
      details,
    };

    this.toolState.set(toolFields.toolCallId, merged);
    this.emit(merged);
  }
}
