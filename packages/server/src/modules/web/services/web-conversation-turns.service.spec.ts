import { Logger } from '@nestjs/common';

import { createWebHarness } from '../testing/web-harness.js';

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

  it('publishes running, then idle only after the second of two overlapping turns ends', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    const second = turns.begin('web-1');
    turns.end('web-1', first);
    turns.markRunning('web-1', second);
    turns.end('web-1', second);

    expect(states()).toEqual(['running', 'idle']);
  });

  it('reports queued only while every active turn is queued', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    turns.markQueued('web-1', first);
    const second = turns.begin('web-1');
    turns.markQueued('web-1', second);
    turns.markRunning('web-1', first);
    turns.markQueued('web-1', first);

    expect(states()).toEqual(['running', 'queued', 'running', 'queued', 'running', 'queued']);
  });

  it('ignores marks for a turn that has ended and ends a turn idempotently', () => {
    const { turns, states } = setup();

    const turn = turns.begin('web-1');
    turns.end('web-1', turn);
    turns.markQueued('web-1', turn);
    turns.end('web-1', turn);

    expect(states()).toEqual(['running', 'idle']);
  });

  it('tracks each conversation on its own', () => {
    const { turns, states } = setup();

    const first = turns.begin('web-1');
    const other = turns.begin('web-2');
    turns.end('web-1', first);

    expect(states('web-1')).toEqual(['running', 'idle']);
    expect(states('web-2')).toEqual(['running']);
    turns.end('web-2', other);
  });

  it('reports the same state in the events service that the history reads', () => {
    const { turns, events } = setup();

    turns.begin('web-1');

    expect(events.stateOf('web-1')).toBe('running');
  });

  it('closes the open questions before idle and flushes the store', async () => {
    const { turns, events, store, observer } = setup();
    await events.publishEntry('web-1', questionEntry);
    const turn = turns.begin('web-1');
    observer.sent.length = 0;

    turns.end('web-1', turn);

    expect(observer.sent.map(event => event.type)).toEqual(['conversation.entry', 'conversation.state']);
    expect(observer.sent[0]).toMatchObject({ entry: { id: 'q1', closed: true } });
    await vi.waitFor(() => expect(store.flushed).toEqual(['web-1']));
    expect((await store.history('web-1'))[0]).toMatchObject({ id: 'q1', closed: true });
  });

  it('survives a flush failure', async () => {
    const { turns, store } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(store, 'flush').mockRejectedValue(new Error('disk full'));

    turns.end('web-1', turns.begin('web-1'));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full')));
  });

  it('describes a non-Error flush failure', async () => {
    const { turns, store } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(store, 'flush').mockRejectedValue('nope');

    turns.end('web-1', turns.begin('web-1'));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope')));
  });

  it('is built from the events service and the store', () => {
    const { events, store, questions, agentTurn } = setup();

    expect(new WebConversationTurnsService(events, store, questions, agentTurn)).toBeInstanceOf(WebConversationTurnsService);
  });

  it('leaves a restored question open when the conversation becomes idle', async () => {
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
