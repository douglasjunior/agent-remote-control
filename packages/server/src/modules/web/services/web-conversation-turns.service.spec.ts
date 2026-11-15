import { Logger } from '@nestjs/common';

import { createWebHarness } from '../testing/web-harness.js';

import { ConversationEntryService } from './conversation-entry.service.js';
import { WebConversationTurnsService } from './web-conversation-turns.service.js';


const questionEntry = {
  id: 'q1',
  at: '2026-01-01T00:00:00.000Z',
  type: 'question' as const,
  askerRole: 'DEVELOPER',
  askerRoleName: 'Developer',
  text: 'Which?',
  options: [],
  number: 1,
  total: 1,
  closed: false,
};

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  harness.store.seed('web-2');
  const states = (id = 'web-1') => harness.observer.sent.flatMap(event => (event.type === 'conversation.state' && event.conversationId === id ? [event.state] : []));
  return { ...harness, states };
}

describe('WebConversationTurnsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should publish running, then idle only after the second of two overlapping turns ends', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    const second = turns.begin('web-1');
    turns.end('web-1', first);
    turns.markRunning('web-1', second);
    turns.end('web-1', second);

    expect(states()).toEqual(['running', 'idle']);
  });

  it('should report queued only while every active turn is queued', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    turns.markQueued('web-1', first);
    const second = turns.begin('web-1');
    turns.markQueued('web-1', second);
    turns.markRunning('web-1', first);
    turns.markQueued('web-1', first);

    expect(states()).toEqual(['running', 'queued', 'running', 'queued', 'running', 'queued']);
  });

  it('should ignore marks for a turn that has ended and end a turn idempotently', () => {
    const { turns, states } = setup();

    const turn = turns.begin('web-1');
    turns.end('web-1', turn);
    turns.markQueued('web-1', turn);
    turns.end('web-1', turn);

    expect(states()).toEqual(['running', 'idle']);
  });

  it('should track each conversation on its own', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    const other = turns.begin('web-2');
    turns.end('web-1', first);

    expect(states('web-1')).toEqual(['running', 'idle']);
    expect(states('web-2')).toEqual(['running']);
    turns.end('web-2', other);
  });

  it('should report the same state in the events service that the history reads', () => {
    const { turns, events } = setup();

    turns.begin('web-1');

    expect(events.stateOf('web-1')).toBe('running');
  });

  it('should close the open questions as it goes idle and flush the store', async () => {
    const { turns, events, store, observer } = setup();
    await events.publishEntry('web-1', questionEntry);
    const turn = turns.begin('web-1');
    observer.sent.length = 0;

    turns.end('web-1', turn);

    expect(events.hasOpenQuestion('web-1')).toBe(false);
    await vi.waitFor(() => expect(store.flushed).toEqual(['web-1']));
    expect(observer.sent).toEqual([
      { type: 'conversation.state', conversationId: 'web-1', state: 'idle' },
      expect.objectContaining({ type: 'conversation.entry', entry: expect.objectContaining({ id: 'q1', closed: true }), position: 0 }),
    ]);
    expect((await store.history('web-1'))[0]).toMatchObject({ id: 'q1', closed: true });
  });

  it('should survive a flush failure', async () => {
    const { turns, store } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(store, 'flush').mockRejectedValue(new Error('disk full'));

    turns.end('web-1', turns.begin('web-1'));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full')));
  });

  it('should describe a non-Error flush failure', async () => {
    const { turns, store } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(store, 'flush').mockRejectedValue('nope');

    turns.end('web-1', turns.begin('web-1'));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope')));
  });

  it('should be built from the events service and the store', () => {
    const { events, store, questions, agentTurn } = setup();

    expect(new WebConversationTurnsService(events, store, questions, agentTurn, new ConversationEntryService())).toBeInstanceOf(WebConversationTurnsService);
  });

  it('should leave a restored question open when the conversation becomes idle', async () => {
    const { turns, events, store, questions } = setup();
    store.seed('web-1');
    const question = { id: 'q', at: '2026-01-01T00:00:00.000Z', type: 'question' as const, askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: false };
    await events.publishEntry('web-1', question);
    questions.pending = true;

    turns.end('web-1', turns.begin('web-1'));
    await vi.waitFor(() => expect(store.flushed).toContain('web-1'));

    expect(await store.history('web-1')).toEqual([question]);
  });
});
