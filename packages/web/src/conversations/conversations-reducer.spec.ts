import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';

import { conversationsReducer, initialConversationsState, type ConversationsState } from './conversations-reducer.js';


function summary(id: string, updatedAt: string, title = id): ConversationSummary {
  return { id, title, createdAt: '2026-01-01T00:00:00.000Z', updatedAt };
}

function userEntry(id: string, text = id): ConversationEntry {
  return { id, at: '2026-01-01T00:00:00.000Z', type: 'user_message', text };
}

function reduce(events: ServerEvent[], state: ConversationsState = initialConversationsState) {
  return events.reduce(conversationsReducer, state);
}

describe('conversationsReducer', () => {
  it('should replace the list ordered by updatedAt descending', () => {
    const state = reduce([
      {
        type: 'conversation.list',
        conversations: [summary('a', '2026-01-01T00:00:00.000Z'), summary('b', '2026-01-02T00:00:00.000Z')],
      },
    ]);
    expect(state.list.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('should add created conversations and reorder updated ones in place', () => {
    const state = reduce([
      { type: 'conversation.list', conversations: [summary('a', '2026-01-01T00:00:00.000Z')] },
      { type: 'conversation.created', requestId: 'r', conversation: summary('b', '2026-01-02T00:00:00.000Z') },
      { type: 'conversation.updated', conversation: summary('a', '2026-01-03T00:00:00.000Z', 'renamed') },
    ]);
    expect(state.list.map(item => item.id)).toEqual(['a', 'b']);
    expect(state.list[0].title).toBe('renamed');
  });

  it('should add an updated conversation that is not in the list yet', () => {
    const state = reduce([{ type: 'conversation.updated', conversation: summary('a', '2026-01-01T00:00:00.000Z') }]);
    expect(state.list).toHaveLength(1);
  });

  it('should replace a conversation wholesale on history', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('old'), position: 0 },
      { type: 'conversation.history', conversationId: 'c', start: 0, entries: [userEntry('x'), userEntry('y')], state: 'running' },
    ]);
    const view = state.byId.c;
    expect(view.entryIds).toEqual(['x', 'y']);
    expect(Object.keys(view.entries)).toEqual(['x', 'y']);
    expect(view.state).toBe('running');
    expect(view.loaded).toBe(true);
  });

  it('should keep the response being written and replace it at every event', () => {
    const state = reduce([
      { type: 'conversation.draft', conversationId: 'c', text: 'Working' },
      { type: 'conversation.draft', conversationId: 'c', text: 'Working on it' },
    ]);
    expect(state.byId.c.draft).toBe('Working on it');
    expect(reduce([{ type: 'conversation.draft', conversationId: 'c', text: '' }], state).byId.c.draft).toBe('');
  });

  it('should take the draft a history carries and none when it carries none', () => {
    const withDraft = reduce([{ type: 'conversation.history', conversationId: 'c', start: 0, entries: [], state: 'running', draft: 'Working' }]);
    expect(withDraft.byId.c.draft).toBe('Working');
    expect(reduce([{ type: 'conversation.history', conversationId: 'c', start: 0, entries: [], state: 'idle' }], withDraft).byId.c.draft).toBe('');
  });

  it('should append a new entry and replace an existing id in place', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('a', 'first'), position: 0 },
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('b'), position: 1 },
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('a', 'second'), position: 0 },
    ]);
    expect(state.byId.c.entryIds).toEqual(['a', 'b']);
    expect(state.byId.c.entries.a).toMatchObject({ text: 'second' });
    expect(state.byId.c.loaded).toBe(false);
  });

  describe('pages of entries', () => {
    const history = (start: number, ids: string[]): ServerEvent => ({ type: 'conversation.history', conversationId: 'c', start, entries: ids.map(id => userEntry(id)), state: 'idle' });
    const earlier = (start: number, ids: string[]): ServerEvent => ({ type: 'conversation.entries', conversationId: 'c', start, entries: ids.map(id => userEntry(id)) });
    const live = (id: string, position: number, text = id): ServerEvent => ({ type: 'conversation.entry', conversationId: 'c', entry: userEntry(id, text), position });

    it('should hold the latest page from its position', () => {
      const view = reduce([history(4, ['e', 'f'])]).byId.c;

      expect(view).toMatchObject({ start: 4, entryIds: ['e', 'f'], positions: { e: 4, f: 5 } });
    });

    it('should put an earlier page before the entries held', () => {
      const view = reduce([history(4, ['e', 'f']), earlier(1, ['b', 'c', 'd']), earlier(0, ['a'])]).byId.c;

      expect(view).toMatchObject({ start: 0, entryIds: ['a', 'b', 'c', 'd', 'e', 'f'], positions: { a: 0, d: 3, f: 5 } });
    });

    it('should ignore an earlier page that does not end where the entries held start', () => {
      const loaded = reduce([history(4, ['e', 'f'])]);

      expect(reduce([earlier(0, ['a', 'b'])], loaded)).toBe(loaded);
      expect(reduce([earlier(0, ['a'])])).toBe(initialConversationsState);
    });

    it('should leave out a live entry before the entries held, which its page will carry', () => {
      const loaded = reduce([history(4, ['e', 'f'])]);

      expect(reduce([live('b', 1)], loaded)).toBe(loaded);
    });

    it('should place a live entry by its position and replace one held in place', () => {
      const view = reduce([history(4, ['e', 'g']), live('h', 7), live('e', 4, 'changed')]).byId.c;

      expect(view.entryIds).toEqual(['e', 'g', 'h']);
      expect(view.entries.e).toMatchObject({ text: 'changed' });
      expect(reduce([{ ...history(4, ['e']) }, live('g', 6), live('f', 5)]).byId.c.entryIds).toEqual(['e', 'f', 'g']);
    });

    it('should keep the live entries that came ahead of the page holding the entries before them', () => {
      const view = reduce([live('old', 1), live('g', 6), history(4, ['e', 'f'])]).byId.c;

      expect(view.entryIds).toEqual(['e', 'f', 'g']);
      expect(view.entries.old).toBeUndefined();
    });
  });

  it('should track the conversation state without touching other conversations', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'other', entry: userEntry('a'), position: 0 },
      { type: 'conversation.state', conversationId: 'c', state: 'queued' },
    ]);
    expect(state.byId.c.state).toBe('queued');
    expect(state.byId.other.state).toBe('idle');
  });

  it('should remember the last entry held when the state was set', () => {
    const loaded: ServerEvent = { type: 'conversation.history', conversationId: 'c', start: 0, entries: [userEntry('a')], state: 'running' };
    const later: ServerEvent = { type: 'conversation.entry', conversationId: 'c', entry: userEntry('b'), position: 1 };

    expect(reduce([loaded, later]).byId.c.stateAfter).toBe('a');
    expect(reduce([loaded, later, { type: 'conversation.state', conversationId: 'c', state: 'queued' }]).byId.c.stateAfter).toBe('b');
  });

  it('should store the agents list', () => {
    const state = reduce([{ type: 'agents.list', agents: [{ id: 'codex', name: 'Codex' }] }]);
    expect(state.agents).toEqual([{ id: 'codex', name: 'Codex' }]);
  });

  it('should store profiles, the configured flag and the applied squad', () => {
    const profiles = [{ role: 'CEO', roleName: 'CEO' }];
    const appliedSquad = { id: 's', name: 'Backend team' };
    const state = reduce([{ type: 'profiles', conversationId: 'c', configured: true, profiles, appliedSquad, customized: true }]);
    expect(state.byId.c).toMatchObject({ configured: true, profiles, profilesLoaded: true, appliedSquad, customized: true });

    const custom = reduce([{ type: 'profiles', conversationId: 'c', configured: true, profiles, customized: false }]);
    expect(custom.byId.c.appliedSquad).toBeUndefined();
  });

  it.each<ServerEvent>([
    { type: 'auth.ok' },
    { type: 'auth.failed' },
    { type: 'pong' },
    { type: 'models.list', agentId: 'a', models: [] },
    { type: 'efforts.list', agentId: 'a', modelId: 'm', efforts: [] },
    { type: 'squads', squads: [] },
    { type: 'error', message: 'boom' },
  ])('should ignore $type', (event) => {
    expect(conversationsReducer(initialConversationsState, event)).toBe(initialConversationsState);
  });

  it('should keep the interrupted work from the history and from its own event', () => {
    const work = { id: 'w', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build' };

    const loaded = reduce([{ type: 'conversation.history', conversationId: 'a', start: 0, entries: [], state: 'idle', interrupted: [work] }]);
    expect(loaded.byId.a?.interrupted).toEqual([work]);

    expect(reduce([{ type: 'conversation.interrupted', conversationId: 'a', interrupted: [] }], loaded).byId.a?.interrupted).toEqual([]);
    expect(reduce([{ type: 'conversation.history', conversationId: 'a', start: 0, entries: [], state: 'idle' }], loaded).byId.a?.interrupted).toEqual([]);
  });
});
