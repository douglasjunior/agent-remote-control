import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { FakeConversationStore } from '../testing/fake-conversation-store.js';
import { createWebHarness } from '../testing/web-harness.js';

import { ConversationEntryService } from './conversation-entry.service.js';
import { WebConnectionRegistryService } from './web-connection-registry.service.js';
import { WebConversationEventsService } from './web-conversation-events.service.js';


const entry: ConversationEntry = { id: 'e1', at: '2026-01-01T00:00:00.000Z', type: 'interim', text: 'x' };

describe('WebConversationEventsService', () => {
  it('persists an entry and broadcasts it', async () => {
    const { events, store, observer } = createWebHarness();
    store.seed('web-1');

    await events.publishEntry('web-1', entry);

    expect(observer.sent).toEqual([{ type: 'conversation.entry', conversationId: 'web-1', entry }]);
    expect(await store.history('web-1')).toEqual([entry]);
  });

  it('still broadcasts when the store fails', async () => {
    const registry = new WebConnectionRegistryService();
    const observer = new FakeClientConnection('observer');
    registry.register(observer);
    const store = new FakeConversationStore();
    vi.spyOn(store, 'upsertEntry').mockRejectedValue(new Error('disk full'));
    const events = new WebConversationEventsService(store, registry, new ConversationEntryService());

    await expect(events.publishEntry('web-1', entry)).resolves.toBeUndefined();

    expect(observer.sent).toHaveLength(1);
  });

  it('tracks and broadcasts the state, defaulting to idle', () => {
    const { events, observer } = createWebHarness();

    expect(events.stateOf('web-1')).toBe('idle');
    events.publishState('web-1', 'running');

    expect(events.stateOf('web-1')).toBe('running');
    expect(observer.sent).toEqual([{ type: 'conversation.state', conversationId: 'web-1', state: 'running' }]);
  });

  describe('draft', () => {
    const draftEvents = (observer: { sent: readonly unknown[] }) => observer.sent.filter(event => (event as { type: string }).type === 'conversation.draft');

    it('broadcasts the response being written and keeps it for whoever opens the conversation later', () => {
      const { events, observer } = createWebHarness();

      events.publishDraft('web-1', 'Working');
      events.publishDraft('web-1', 'Working on it');

      expect(events.draftOf('web-1')).toBe('Working on it');
      expect(draftEvents(observer)).toEqual([
        { type: 'conversation.draft', conversationId: 'web-1', text: 'Working' },
        { type: 'conversation.draft', conversationId: 'web-1', text: 'Working on it' },
      ]);
    });

    it('has no draft by default and broadcasts a text only when it changes', () => {
      const { events, observer } = createWebHarness();

      events.publishDraft('web-1', '');
      events.publishDraft('web-1', 'a');
      events.publishDraft('web-1', 'a');

      expect(events.draftOf('other')).toBe('');
      expect(draftEvents(observer)).toHaveLength(1);
    });

    it('does not store the draft in the history', async () => {
      const { events, store } = createWebHarness();
      store.seed('web-1');

      events.publishDraft('web-1', 'Working');

      expect(await store.history('web-1')).toEqual([]);
    });

    it.each<[string, ConversationEntry]>([
      ['an interim message', { id: 'i', at: entry.at, type: 'interim', text: 'x' }],
      ['a question', { id: 'q', at: entry.at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: false }],
      ['the final response', { id: 'r', at: entry.at, type: 'agent_response', status: 'completed', response: 'x' }],
      ['a cancelled response', { id: 'r', at: entry.at, type: 'agent_response', status: 'cancelled', response: 'x' }],
    ])('is replaced by %s, with the discard sent before the entry', async (_name, delivered) => {
      const { events, store, observer } = createWebHarness();
      store.seed('web-1');
      events.publishDraft('web-1', 'Working');

      await events.publishEntry('web-1', delivered);

      expect(events.draftOf('web-1')).toBe('');
      expect(observer.sent.map(event => (event.type === 'conversation.draft' ? `draft:${event.text}` : event.type))).toEqual([
        'draft:Working',
        'draft:',
        'conversation.entry',
      ]);
    });

    it('is kept when a question is closed in place', async () => {
      const { events, store } = createWebHarness();
      store.seed('web-1');
      events.publishDraft('web-1', 'Working');

      await events.publishEntry('web-1', { id: 'q', at: entry.at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: true });

      expect(events.draftOf('web-1')).toBe('Working');
    });

    it.each<[string, ConversationEntry]>([
      ['a thought', { id: 't', at: entry.at, type: 'thought', role: 'CEO', text: 'x' }],
      ['a delegation', { id: 'd', at: entry.at, type: 'delegation', phase: 'started', delegationId: 'dl-1', round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: 'Do the work', summary: 'Doing the work' }],
      ['a notice', { id: 'n', at: entry.at, type: 'notice', level: 'info', text: 'x' }],
      ['a steered prompt', { id: 'r', at: entry.at, type: 'agent_response', status: 'steered', response: '' }],
    ])('survives %s', async (_name, other) => {
      const { events, store } = createWebHarness();
      store.seed('web-1');
      events.publishDraft('web-1', 'Working');

      await events.publishEntry('web-1', other);

      expect(events.draftOf('web-1')).toBe('Working');
    });

    it('is discarded when the conversation goes idle, however the turn ended', () => {
      const { events, observer } = createWebHarness();
      events.publishDraft('web-1', 'Working');

      events.publishState('web-1', 'running');
      expect(events.draftOf('web-1')).toBe('Working');
      events.publishState('web-1', 'idle');

      expect(events.draftOf('web-1')).toBe('');
      expect(observer.sent.map(event => event.type)).toEqual(['conversation.draft', 'conversation.state', 'conversation.draft', 'conversation.state']);
    });
  });

  it('broadcasts conversation updates except to the excluded connection', () => {
    const { events, registry, observer } = createWebHarness();
    const requester = new FakeClientConnection('requester');
    registry.register(requester);
    const conversation = { id: 'web-1', title: 'T', createdAt: entry.at, updatedAt: entry.at };

    events.publishConversation(conversation, 'requester');

    expect(observer.sent).toEqual([{ type: 'conversation.updated', conversation }]);
    expect(requester.sent).toEqual([]);
  });

  it('broadcasts the profiles of a conversation', () => {
    const { events, observer } = createWebHarness();

    events.publishProfiles('web-1', true, [{ role: 'CEO', roleName: 'CEO' }]);

    expect(observer.sent).toEqual([{ type: 'profiles', conversationId: 'web-1', configured: true, profiles: [{ role: 'CEO', roleName: 'CEO' }] }]);
  });

  describe('closeOpenQuestions', () => {
    const question: ConversationEntry = { id: 'q', at: entry.at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: false };

    it('upserts each open question as closed, in place', async () => {
      const { events, store, observer } = createWebHarness();
      store.seed('web-1');
      await events.publishEntry('web-1', question);
      await events.publishEntry('web-1', entry);

      await events.closeOpenQuestions('web-1');

      expect(await store.history('web-1')).toEqual([{ ...question, closed: true }, entry]);
      expect(observer.sent.at(-1)).toEqual({ type: 'conversation.entry', conversationId: 'web-1', entry: { ...question, closed: true } });
    });

    it('does nothing once the questions are closed or when there were none', async () => {
      const { events, store, observer } = createWebHarness();
      store.seed('web-1');
      await events.publishEntry('web-1', question);
      await events.closeOpenQuestions('web-1');
      observer.sent.length = 0;

      await events.closeOpenQuestions('web-1');
      await events.closeOpenQuestions('other');

      expect(observer.sent).toEqual([]);
    });
  });

  describe('settleOrphanedQuestions', () => {
    const question: ConversationEntry = { id: 'q', at: entry.at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: false };

    it('closes a question left open by an earlier process and records one notice', async () => {
      const { events, store, observer } = createWebHarness();
      store.seed('web-1');
      await store.upsertEntry('web-1', question);

      await Promise.all([events.settleOrphanedQuestions('web-1', () => false), events.settleOrphanedQuestions('web-1', () => false)]);

      expect(await store.history('web-1')).toEqual([
        { ...question, closed: true },
        expect.objectContaining({ id: 'question-abandoned:q', type: 'notice', level: 'warning' }),
      ]);
      expect(observer.sent).toContainEqual({ type: 'conversation.entry', conversationId: 'web-1', entry: { ...question, closed: true } });
    });

    it('keeps a question this process is waiting on open', async () => {
      const { events, store } = createWebHarness();
      store.seed('web-1');
      await events.publishEntry('web-1', question);

      await events.settleOrphanedQuestions('web-1', () => false);

      expect(await store.history('web-1')).toEqual([question]);
    });

    it('tracks a question the queue restored, leaving it open', async () => {
      const { events, store } = createWebHarness();
      store.seed('web-1');
      await store.upsertEntry('web-1', question);

      await events.settleOrphanedQuestions('web-1', () => true);

      expect(await store.history('web-1')).toEqual([question]);
      expect(events.hasOpenQuestion('web-1')).toBe(true);
      await events.closeOpenQuestions('web-1');
      expect(events.hasOpenQuestion('web-1')).toBe(false);
    });
  });

  it('publishes the interrupted work', () => {
    const { events, observer } = createWebHarness();
    const interrupted = [{ id: 'w', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build' }];

    events.publishInterrupted('web-1', interrupted);

    expect(observer.sent).toEqual([{ type: 'conversation.interrupted', conversationId: 'web-1', interrupted }]);
  });

  it('records nothing once shutting down', async () => {
    const { events, store, observer } = createWebHarness();
    store.seed('web-1');
    events.onModuleDestroy();

    await events.publishEntry('web-1', entry);

    expect(observer.sent).toEqual([]);
    expect(await store.history('web-1')).toEqual([]);
  });

  describe('closeUnanswerableQuestions', () => {
    const question: ConversationEntry = { id: 'q', at: entry.at, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Dev', text: 'Which?', options: [], number: 1, total: 1, closed: false };

    it('closes a question this process published and stops tracking it', async () => {
      const { events, store, observer } = createWebHarness();
      store.seed('web-1');
      await events.publishEntry('web-1', question);

      await events.closeUnanswerableQuestions('web-1');

      expect(await store.history('web-1')).toEqual([
        { ...question, closed: true },
        expect.objectContaining({ id: 'question-abandoned:q', type: 'notice' }),
      ]);
      observer.sent.length = 0;
      await events.closeOpenQuestions('web-1');
      expect(observer.sent).toEqual([]);
    });

    it('records nothing when no question is open', async () => {
      const { events, store } = createWebHarness();
      store.seed('web-1');

      await events.closeUnanswerableQuestions('web-1');

      expect(await store.history('web-1')).toEqual([]);
    });
  });
});
