import type {
  SessionNotification,
  ToolCallStatus,
} from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import type { AgentActivity } from '../ports/agent.port.js';

import { AgentStreamDemux } from './agent-stream-demux.js';


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
    rs.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    rs.useRealTimers();
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
      details: 'file contents',
    });
  });

  it('should expose the last non-empty narration as lastAgentMessage', () => {
    const { demux } = createDemux();

    demux.handle(textNotif('first', 'm1'));
    demux.handle(textNotif('   ', 'm1'));
    demux.handle(textNotif('second', 'm2'));
    demux.handle(textNotif(' part', 'm2'));
    demux.handle(thoughtNotif('reasoning', 't1'));

    expect(demux.lastAgentMessage).toBe('second part');
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
    rs.advanceTimersByTime(IDLE_MS);
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
    rs.advanceTimersByTime(IDLE_MS);
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
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(textNotif('Part 2.', 'm1'));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);
    expect(thoughts(emitted).at(-1)?.text).toBe('Part 1. Part 2.');
  });

  it('should not close a block before the idle window elapses', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('Investigating...', 'm1'));
    rs.advanceTimersByTime(IDLE_MS - 1);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);
  });

  it('should emit continuation of a closed message under derived id with new text', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('First block.', 'm1'));
    rs.advanceTimersByTime(IDLE_MS);
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
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));
    demux.handle(textNotif('Block 2.', 'm1'));
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).filter(t => t.final === true)).toEqual([
      { kind: 'thought', id: 'm1', text: 'Block 1.', final: true },
      { kind: 'thought', id: 'm1#1', text: 'Block 2.', final: true },
    ]);
  });

  it('should default the idle window to 3000ms', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('waiting', 'm1'));
    rs.advanceTimersByTime(2_999);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted).some(t => t.final === true)).toBe(false);

    rs.advanceTimersByTime(1);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).at(-1)).toMatchObject({ id: 'm1', final: true });
  });

  it('should close an idle synthetic block', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('synthetic preamble'));
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c2', status: 'pending' }));

    expect(thoughts(emitted).filter(t => t.final === true)).toEqual([expect.objectContaining({ text: 'synthetic preamble', final: true })]);
  });

  it('should not close anything when idle block has no visible text', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(textNotif('   ', 'm1'));
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(toolCallNotif({ toolCallId: 'c1', status: 'pending' }));

    expect(thoughts(emitted)).toHaveLength(0);
  });
});

describe('AgentStreamDemux protocol tags', () => {
  beforeEach(() => {
    rs.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should hand over what the agent wrote with the tags it used', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('Wrapping up. <final_', 'm1'));
    demux.handle(textNotif('response>Report</final_response>', 'm1'));

    expect(thoughts(emitted).at(-1)).toEqual({ kind: 'thought', id: 'm1', text: 'Wrapping up. <final_response>Report</final_response>' });
    expect(demux.takeFinalText()).toBe('Wrapping up. <final_response>Report</final_response>');
  });

  it('should join the messages of the turn and leave reasoning out', () => {
    const { demux } = createDemux();

    demux.handle(thoughtNotif('Thinking about it.', 't1'));
    demux.handle(textNotif('Reading the code.', 'm1'));
    demux.handle(textNotif('<final_response>Fixed.</final_response>', 'm2'));

    expect(demux.takeFinalText()).toBe('Reading the code.\n\n<final_response>Fixed.</final_response>');
  });

  it('should mark reasoning blocks, closed or not', () => {
    const { demux, emitted } = createDemux(IDLE_MS);

    demux.handle(thoughtNotif('Thinking.', 't1'));
    rs.advanceTimersByTime(IDLE_MS);
    demux.handle(textNotif('Answer.', 'm1'));

    expect(thoughts(emitted)).toEqual([
      { kind: 'thought', id: 't1:thought', text: 'Thinking.', reasoning: true },
      { kind: 'thought', id: 't1:thought', text: 'Thinking.', final: true, reasoning: true },
      { kind: 'thought', id: 'm1', text: 'Answer.' },
    ]);
  });
});

function toolNotifWithContent(content: unknown[]): SessionNotification {
  return {
    sessionId: 's',
    update: { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'tool', content },
  } as unknown as SessionNotification;
}

function textContent(text: string) {
  return { type: 'content', content: { type: 'text', text } };
}

function lastTool(emitted: AgentActivity[]) {
  return emitted.filter((a): a is AgentActivity & { kind: 'tool' } => a.kind === 'tool').at(-1);
}

describe('AgentStreamDemux tool call fields', () => {
  it('should emit the fields of a tool_call', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolCallNotif({ toolCallId: 'call-1', title: 'Read states.md', status: 'pending' }));

    expect(emitted).toEqual([{ kind: 'tool', toolCallId: 'call-1', title: 'Read states.md', status: 'pending', result: undefined, details: undefined }]);
  });

  it('should emit a tool_call_update without a title under the tool call id', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolUpdateNotif({ toolCallId: 'call-1', status: 'completed' }));

    expect(emitted).toEqual([{ kind: 'tool', toolCallId: 'call-1', title: 'call-1', status: 'completed', result: undefined, details: undefined }]);
  });

  it('should emit nothing for an update that is neither a tool call nor text', () => {
    const { demux, emitted } = createDemux();

    demux.handle(planNotif());

    expect(emitted).toEqual([]);
  });
});

describe('AgentStreamDemux text chunk fields', () => {
  it('should ignore a chunk that is not from the agent', () => {
    const { demux, emitted } = createDemux();

    demux.handle({
      sessionId: 's',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } },
    } as unknown as SessionNotification);

    expect(emitted).toEqual([]);
    expect(demux.takeFinalText()).toBe('');
  });

  it('should ignore a chunk whose content is not text', () => {
    const { demux, emitted } = createDemux();

    demux.handle({
      sessionId: 's',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'abc', mimeType: 'image/png' },
      },
    } as unknown as SessionNotification);

    expect(emitted).toEqual([]);
  });

  it('should take the text and message id of an agent_message_chunk', () => {
    const { demux, emitted } = createDemux();

    demux.handle(textNotif('response', 'msg-1'));

    expect(emitted).toEqual([{ kind: 'thought', id: 'msg-1', text: 'response' }]);
  });

  it('should mark an agent_thought_chunk as reasoning', () => {
    const { demux, emitted } = createDemux();

    demux.handle(thoughtNotif('thinking'));

    expect(emitted).toEqual([{ kind: 'thought', id: 'synthetic:0:thought', text: 'thinking', reasoning: true }]);
  });
});

describe('AgentStreamDemux tool result and details', () => {
  it('should leave the result and details undefined when the content is empty or null', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([]));
    expect(lastTool(emitted)).toMatchObject({ result: undefined, details: undefined });

    demux.handle(toolCallNotif({ toolCallId: 'call-2', title: 'tool' }));
    expect(lastTool(emitted)).toMatchObject({ result: undefined, details: undefined });
  });

  it('should ignore content items that are not text', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([{ type: 'diff', path: 'a.txt', newText: 'b' }]));

    expect(lastTool(emitted)).toMatchObject({ result: undefined, details: undefined });
  });

  it('should summarize the result with meaningful lines, skipping code fences and empty lines', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([textContent('```ts\nline 1\n\nline 2\n```')]));

    expect(lastTool(emitted)?.result).toBe('line 1\nline 2');
  });

  it('should cut a result of more than five lines with an ellipsis', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([textContent('l1\nl2\nl3\nl4\nl5\nl6\nl7')]));

    expect(lastTool(emitted)?.result).toBe('l1\nl2\nl3\nl4\nl5\n...');
  });

  it('should skip a text item without meaningful lines when summarizing the result', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([textContent('```\n```'), textContent('second')]));

    expect(lastTool(emitted)?.result).toBe('second');
  });

  it('should give the details in full, without cutting lines', () => {
    const { demux, emitted } = createDemux();
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n');

    demux.handle(toolNotifWithContent([textContent(lines)]));

    expect(lastTool(emitted)?.details).toBe(lines);
  });

  it('should join the text items of the details with a newline', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([textContent('first part'), textContent('second part')]));

    expect(lastTool(emitted)?.details).toBe('first part\nsecond part');
  });

  it('should skip whitespace-only text items in the details', () => {
    const { demux, emitted } = createDemux();

    demux.handle(toolNotifWithContent([textContent('   ')]));

    expect(lastTool(emitted)?.details).toBeUndefined();
  });
});
