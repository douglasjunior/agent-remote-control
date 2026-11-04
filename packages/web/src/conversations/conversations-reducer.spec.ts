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
});
