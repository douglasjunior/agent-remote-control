import type {
  SessionNotification,
  ToolCallStatus,
} from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentActivity } from '../ports/agent.port.js';

import {
  AgentStreamDemux,
  extractAgentTextChunk,
  extractToolCallFields,
  extractToolResultSummary,
} from './agent-stream-demux.js';


function textNotif(text: string, messageId?: string): SessionNotification {
  return {
    sessionId: 's',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId,
    },
  } as unknown as SessionNotification;
}

function thoughtNotif(text: string, messageId?: string): SessionNotification {
  return {
    sessionId: 's',
    update: {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text },
      messageId,
    },
  } as unknown as SessionNotification;
}

function toolCallNotif(fields: {
  toolCallId: string;
  title?: string;
  status?: ToolCallStatus;
  resultText?: string;
}): SessionNotification {
  return {
    sessionId: 's',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: fields.toolCallId,
      title: fields.title,
      status: fields.status,
      content: fields.resultText
        ? [
          {
            type: 'content',
            content: { type: 'text', text: fields.resultText },
          },
        ]
        : null,
    },
  } as unknown as SessionNotification;
}

function toolUpdateNotif(fields: {
  toolCallId: string;
  status?: ToolCallStatus;
  resultText?: string;
}): SessionNotification {
  return {
    sessionId: 's',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: fields.toolCallId,
      status: fields.status,
      content: fields.resultText
        ? [
          {
            type: 'content',
            content: { type: 'text', text: fields.resultText },
          },
        ]
        : null,
    },
  } as unknown as SessionNotification;
}

function planNotif(): SessionNotification {
  return {
    sessionId: 's',
    update: { sessionUpdate: 'plan', entries: [] },
  } as unknown as SessionNotification;
}

const IDLE_MS = 1_000;

function createDemux(idleMs?: number) {
  const emitted: AgentActivity[] = [];
  const demux = new AgentStreamDemux(
    activity => emitted.push(activity),
    idleMs,
  );
  return { demux, emitted };
}

function thoughts(emitted: AgentActivity[]) {
  return emitted.filter(
    (a): a is AgentActivity & { kind: 'thought' } => a.kind === 'thought',
  );
}

describe('AgentStreamDemux', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should accumulate chunks of the same message into one thought', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Checking ', 'm1'));
    demux.handle(textNotif('files.', 'm1'));

    expect(thoughts(emitted)).toEqual([
      { kind: 'thought', id: 'm1', text: 'Checking' },
      { kind: 'thought', id: 'm1', text: 'Checking files.' },
    ]);
  });

  it('should start a new thought when the messageId changes', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('First message.', 'm1'));
    demux.handle(textNotif('Second message.', 'm2'));

    expect(thoughts(emitted)).toEqual([
      { kind: 'thought', id: 'm1', text: 'First message.' },
      { kind: 'thought', id: 'm2', text: 'Second message.' },
    ]);
  });

  it('should not close a thought when another messageId arrives (interleaved subagents)', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Part A', 'm1'));
    demux.handle(textNotif('Part B', 'm2'));
    demux.handle(textNotif(' and rest of A', 'm1'));

    expect(thoughts(emitted).some(thought => thought.final === true)).toBe(
      false,
    );
    expect(
      thoughts(emitted).findLast(thought => thought.id === 'm1')?.text,
    ).toBe('Part A and rest of A');
  });

  it('should not close the synthetic thought on a tool_call alone without idleness', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('preamble'));
    demux.handle(
      toolCallNotif({ toolCallId: 'c1', title: 'Read', status: 'pending' }),
    );

    expect(thoughts(emitted).some(thought => thought.final === true)).toBe(
      false,
    );
  });

  it('should keep concurrent messages separate without corruption', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Subagent A', 'm1'));
    demux.handle(textNotif('Subagent B', 'm2'));
    demux.handle(textNotif(' continues', 'm1'));

    expect(thoughts(emitted).findLast(t => t.id === 'm1')?.text).toBe(
      'Subagent A continues',
    );
    expect(thoughts(emitted).findLast(t => t.id === 'm2')?.text).toBe(
      'Subagent B',
    );
  });

  it('should keep narration on the same message when a tool_call interleaves with messageId', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Editing ', 'm1'));
    demux.handle(
      toolCallNotif({ toolCallId: 'c1', title: 'Edit', status: 'pending' }),
    );
    demux.handle(textNotif('the file.', 'm1'));

    expect(thoughts(emitted).findLast(t => t.id === 'm1')?.text).toBe(
      'Editing the file.',
    );
  });

  it('should not break narration when a tool_call_update arrives mid-message', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Running ', 'm1'));
    demux.handle(
      toolUpdateNotif({
        toolCallId: 'c1',
        status: 'completed',
        resultText: 'ok',
      }),
    );
    demux.handle(textNotif('tests.', 'm1'));

    expect(thoughts(emitted).at(-1)).toEqual({
      kind: 'thought',
      id: 'm1',
      text: 'Running tests.',
    });
    expect(emitted.some(a => a.kind === 'tool')).toBe(true);
  });

  it('should ignore non-text non-tool events without breaking narration', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('part A ', 'm1'));
    demux.handle(planNotif());
    demux.handle(textNotif('part B', 'm1'));

    expect(thoughts(emitted).at(-1)).toEqual({
      kind: 'thought',
      id: 'm1',
      text: 'part A part B',
    });
  });

  it('should fall back to synthetic id without messageId and start new thought after tool_call', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('step 1'));
    demux.handle(
      toolCallNotif({ toolCallId: 'c1', title: 'Read', status: 'pending' }),
    );
    demux.handle(textNotif('step 2'));

    const ts = thoughts(emitted);
    expect(ts[0]?.text).toBe('step 1');
    expect(ts.at(-1)?.text).toBe('step 2');
    expect(ts[0]?.id).not.toBe(ts.at(-1)?.id);
  });

  it('should keep contiguous chunks in the same thought when messageId is missing', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('chunk 1 '));
    demux.handle(textNotif('chunk 2'));

    const ts = thoughts(emitted);
    expect(ts.at(-1)?.text).toBe('chunk 1 chunk 2');
    expect(ts[0]?.id).toBe(ts.at(-1)?.id);
  });

  it('should merge tool updates by toolCallId', () => {
    const { demux, emitted } = createDemux();

    demux.handle(
      toolCallNotif({
        toolCallId: 'c1',
        title: 'Read a.ts',
        status: 'pending',
      }),
    );
    demux.handle(
      toolUpdateNotif({
        toolCallId: 'c1',
        status: 'completed',
        resultText: 'file contents',
      }),
    );

    expect(emitted.at(-1)).toMatchObject({
      kind: 'tool',
      toolCallId: 'c1',
      title: 'Read a.ts',
      status: 'completed',
      result: 'file contents',
    });
  });

  it('should expose the last non-empty narration as lastAgentMessage', () => {
    const { demux } = createDemux();

    demux.handle(textNotif('first', 'm1'));
    demux.handle(textNotif('   ', 'm1'));
    demux.handle(textNotif('second', 'm1'));

    expect(demux.lastAgentMessage).toBe('second');
  });

  it('should keep synthetic thought ids unique across resets', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('turn 1'));
    demux.reset();
    demux.handle(textNotif('turn 2'));

    const ts = thoughts(emitted);
    expect(ts[0]?.id).not.toBe(ts.at(-1)?.id);
  });

  it('should clear buffer and messages on reset', () => {
    const { demux } = createDemux();

    demux.handle(textNotif('some text', 'm1'));
    demux.reset();

    expect(demux.takeFinalText()).toBe('');
    expect(demux.lastAgentMessage).toBe('');
  });

  it('should default a tool status to pending when none is provided', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolCallNotif({ toolCallId: 'c1', title: 'Read' }));

    expect(emitted.at(-1)).toMatchObject({
      kind: 'tool',
      toolCallId: 'c1',
      status: 'pending',
    });
  });

  it('should inherit previous status when a tool update omits it', () => {
    const { demux, emitted } = createDemux();

    demux.handle(
      toolCallNotif({ toolCallId: 'c1', title: 'Read', status: 'in_progress' }),
    );
    demux.handle(toolUpdateNotif({ toolCallId: 'c1', resultText: 'done' }));

    expect(emitted.at(-1)).toMatchObject({
      kind: 'tool',
      toolCallId: 'c1',
      status: 'in_progress',
      result: 'done',
    });
  });

  it('should return accumulated final text across messages and reset turn state', () => {
    const { demux } = createDemux();

    demux.handle(textNotif('Hello world.', 'm1'));
    demux.handle(textNotif(' Here is your answer.', 'm1'));

    expect(demux.takeFinalText()).toBe('Hello world. Here is your answer.');
    expect(demux.takeFinalText()).toBe('');
  });

  it('should skip agent_thought_chunk in takeFinalText but emit it to the activity feed', () => {
    const { demux, emitted } = createDemux();

    demux.handle(thoughtNotif('Internal reasoning', 't1'));
    demux.handle(textNotif('Final response to user', 'm1'));

    expect(thoughts(emitted).some(t => t.text === 'Internal reasoning')).toBe(
      true,
    );
    expect(demux.takeFinalText()).toBe('Final response to user');
  });

  it('should not emit a thought when content is only whitespace', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('    ', 'm1'));

    expect(thoughts(emitted)).toHaveLength(0);
  });

  it('should close an idle block when a chunk of another message arrives', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Investigating...', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(textNotif('Found it.', 'm2'));

    expect(thoughts(emitted).find(t => t.final === true)).toEqual({
      kind: 'thought',
      id: 'm1',
      text: 'Investigating...',
      final: true,
    });
  });

  it('should close an idle block when a tool call arrives', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Reading file...', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(
      toolCallNotif({ toolCallId: 'c1', title: 'Read', status: 'pending' }),
    );

    expect(thoughts(emitted).at(-1)).toEqual({
      kind: 'thought',
      id: 'm1',
      text: 'Reading file...',
      final: true,
    });
  });

  it('should not close the message that just received the chunk', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Part 1. ', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(textNotif('Part 2.', 'm1'));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);
    expect(thoughts(emitted).at(-1)?.text).toBe('Part 1. Part 2.');
  });

  it('should not close a block before the idle window elapses', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Investigating...', 'm1'));
    vi.advanceTimersByTime(IDLE_MS - 1);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);
  });

  it('should emit continuation of a closed message under derived id with new text', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('First block.', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));
    demux.handle(textNotif('Second block.', 'm1'));

    expect(thoughts(emitted).at(-1)).toEqual({
      kind: 'thought',
      id: 'm1#1',
      text: 'Second block.',
    });
  });

  it('should close continuation block by idleness too', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Block 1.', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));
    demux.handle(textNotif('Block 2.', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).filter(t => t.final === true)).toEqual([
      { kind: 'thought', id: 'm1', text: 'Block 1.', final: true },
      { kind: 'thought', id: 'm1#1', text: 'Block 2.', final: true },
    ]);
  });

  it('should default the idle window to 3000ms', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('waiting', 'm1'));
    vi.advanceTimersByTime(2_999);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);

    vi.advanceTimersByTime(1);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).at(-1)).toMatchObject({ id: 'm1', final: true });
  });

  it('should close an idle synthetic block', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('synthetic preamble'));
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).filter(t => t.final === true)).toEqual([expect.objectContaining({ text: 'synthetic preamble', final: true })]);
  });

  it('should not close anything when idle block has no visible text', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('   ', 'm1'));
    vi.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted)).toHaveLength(0);
  });
});

describe('extractToolCallFields', () => {
  it('should extract fields from a tool_call', () => {
    const result = extractToolCallFields({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read states.md',
        status: 'pending',
      },
    } as unknown as SessionNotification);

    expect(result).toEqual({
      toolCallId: 'call-1',
      title: 'Read states.md',
      status: 'pending',
      content: undefined,
    });
  });

  it('should extract fields from a tool_call_update', () => {
    const result = extractToolCallFields({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
      },
    } as unknown as SessionNotification);

    expect(result).toEqual({
      toolCallId: 'call-1',
      title: undefined,
      status: 'completed',
      content: undefined,
    });
  });

  it('should return null for non tool updates', () => {
    expect(extractToolCallFields(textNotif('Hello'))).toBeNull();
  });
});

describe('extractAgentTextChunk', () => {
  it('should return null when update is not agent text chunk', () => {
    expect(
      extractAgentTextChunk({
        sessionId: 's',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'hi' },
        },
      } as unknown as SessionNotification),
    ).toBeNull();
  });

  it('should return null when content type is not text', () => {
    expect(
      extractAgentTextChunk({
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', data: 'abc', mimeType: 'image/png' },
        },
      } as unknown as SessionNotification),
    ).toBeNull();
  });

  it('should extract text and messageId for agent_message_chunk', () => {
    expect(
      extractAgentTextChunk({
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'response' },
          messageId: 'msg-1',
        },
      } as unknown as SessionNotification),
    ).toEqual({
      text: 'response',
      messageId: 'msg-1',
      isThought: false,
    });
  });

  it('should extract text and mark isThought for agent_thought_chunk', () => {
    expect(
      extractAgentTextChunk({
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'thinking' },
        },
      } as unknown as SessionNotification),
    ).toEqual({
      text: 'thinking',
      messageId: undefined,
      isThought: true,
    });
  });
});

describe('extractToolResultSummary', () => {
  it('should return undefined when content is empty or null', () => {
    expect(extractToolResultSummary(null)).toBeUndefined();
    expect(extractToolResultSummary([])).toBeUndefined();
  });

  it('should ignore non-text content items', () => {
    expect(
      extractToolResultSummary([{ type: 'diff', path: 'a.txt', newText: 'b' } as unknown as any]),
    ).toBeUndefined();
  });

  it('should extract meaningful lines and skip code fences and empty lines', () => {
    const summary = extractToolResultSummary([
      {
        type: 'content',
        content: {
          type: 'text',
          text: '```ts\nline 1\n\nline 2\n```',
        },
      },
    ]);

    expect(summary).toBe('line 1\nline 2');
  });

  it('should truncate lines exceeding MAX_SUMMARY_LINES with ellipsis', () => {
    const summary = extractToolResultSummary([
      {
        type: 'content',
        content: {
          type: 'text',
          text: 'l1\nl2\nl3\nl4\nl5\nl6\nl7',
        },
      },
    ]);

    expect(summary).toBe('l1\nl2\nl3\nl4\nl5\n...');
  });
});
