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
  it('replaces the list ordered by updatedAt descending', () => {
    const state = reduce([
      {
        type: 'conversation.list',
        conversations: [summary('a', '2026-01-01T00:00:00.000Z'), summary('b', '2026-01-02T00:00:00.000Z')],
      },
    ]);
    expect(state.list.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('adds created conversations and reorders updated ones in place', () => {
    const state = reduce([
      { type: 'conversation.list', conversations: [summary('a', '2026-01-01T00:00:00.000Z')] },
      { type: 'conversation.created', requestId: 'r', conversation: summary('b', '2026-01-02T00:00:00.000Z') },
      { type: 'conversation.updated', conversation: summary('a', '2026-01-03T00:00:00.000Z', 'renamed') },
    ]);
    expect(state.list.map(item => item.id)).toEqual(['a', 'b']);
    expect(state.list[0].title).toBe('renamed');
  });

  it('adds an updated conversation that is not in the list yet', () => {
    const state = reduce([{ type: 'conversation.updated', conversation: summary('a', '2026-01-01T00:00:00.000Z') }]);
    expect(state.list).toHaveLength(1);
  });

  it('replaces a conversation wholesale on history', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('old') },
      { type: 'conversation.history', conversationId: 'c', entries: [userEntry('x'), userEntry('y')], state: 'running' },
    ]);
    const view = state.byId.c;
    expect(view.entryIds).toEqual(['x', 'y']);
    expect(Object.keys(view.entries)).toEqual(['x', 'y']);
    expect(view.state).toBe('running');
    expect(view.loaded).toBe(true);
  });

  it('keeps the response being written and replaces it at every event', () => {
    const state = reduce([
      { type: 'conversation.draft', conversationId: 'c', text: 'Working' },
      { type: 'conversation.draft', conversationId: 'c', text: 'Working on it' },
    ]);
    expect(state.byId.c.draft).toBe('Working on it');
    expect(reduce([{ type: 'conversation.draft', conversationId: 'c', text: '' }], state).byId.c.draft).toBe('');
  });

  it('takes the draft a history carries and none when it carries none', () => {
    const withDraft = reduce([{ type: 'conversation.history', conversationId: 'c', entries: [], state: 'running', draft: 'Working' }]);
    expect(withDraft.byId.c.draft).toBe('Working');
    expect(reduce([{ type: 'conversation.history', conversationId: 'c', entries: [], state: 'idle' }], withDraft).byId.c.draft).toBe('');
  });

  it('appends a new entry and replaces an existing id in place', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('a', 'first') },
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('b') },
      { type: 'conversation.entry', conversationId: 'c', entry: userEntry('a', 'second') },
    ]);
    expect(state.byId.c.entryIds).toEqual(['a', 'b']);
    expect(state.byId.c.entries.a).toMatchObject({ text: 'second' });
    expect(state.byId.c.loaded).toBe(false);
  });

  it('tracks the conversation state without touching other conversations', () => {
    const state = reduce([
      { type: 'conversation.entry', conversationId: 'other', entry: userEntry('a') },
      { type: 'conversation.state', conversationId: 'c', state: 'queued' },
    ]);
    expect(state.byId.c.state).toBe('queued');
    expect(state.byId.other.state).toBe('idle');
  });

  it('stores the agents list', () => {
    const state = reduce([{ type: 'agents.list', agents: [{ id: 'codex', name: 'Codex' }] }]);
    expect(state.agents).toEqual([{ id: 'codex', name: 'Codex' }]);
  });

  it('stores profiles and the configured flag', () => {
    const profiles = [{ role: 'CEO', roleName: 'CEO' }];
    const state = reduce([{ type: 'profiles', conversationId: 'c', configured: true, profiles }]);
    expect(state.byId.c).toMatchObject({ configured: true, profiles, profilesLoaded: true });
  });

  it.each<ServerEvent>([
    { type: 'auth.ok' },
    { type: 'auth.failed' },
    { type: 'models.list', agentId: 'a', models: [] },
    { type: 'efforts.list', agentId: 'a', modelId: 'm', efforts: [] },
    { type: 'error', message: 'boom' },
  ])('ignores $type', (event) => {
    expect(conversationsReducer(initialConversationsState, event)).toBe(initialConversationsState);
  });

  it('keeps the interrupted work from the history and from its own event', () => {
    const work = { id: 'w', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build' };

    const loaded = reduce([{ type: 'conversation.history', conversationId: 'a', entries: [], state: 'idle', interrupted: [work] }]);
    expect(loaded.byId.a?.interrupted).toEqual([work]);

    expect(reduce([{ type: 'conversation.interrupted', conversationId: 'a', interrupted: [] }], loaded).byId.a?.interrupted).toEqual([]);
    expect(reduce([{ type: 'conversation.history', conversationId: 'a', entries: [], state: 'idle' }], loaded).byId.a?.interrupted).toEqual([]);
  });
});
