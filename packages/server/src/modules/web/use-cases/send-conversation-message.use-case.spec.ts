import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Logger } from '@nestjs/common';

import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { configuredSettings } from '../testing/configured-settings.js';
import { createWebHarness } from '../testing/web-harness.js';

import { SendConversationMessageUseCase } from './send-conversation-message.use-case.js';


const asker = { role: 'DEVELOPER', roleName: 'Developer', projectName: null };
const prompt: QuestionPrompt = { asker, question: { text: 'Which?', options: ['a', 'b'] }, number: 1, total: 1, waitingAskers: 0 };

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  harness.configuration.store.byConversation.set('web-1', configuredSettings());
  const useCase = new SendConversationMessageUseCase(
    harness.agentTurn,
    harness.configuration,
    harness.events,
    harness.store,
    harness.workspace,
    harness.promptHistory,
    harness.uploads,
  );
  const entries = (): ConversationEntry[] => harness.store.histories.get('web-1') ?? [];
  const types = () => entries().map(entry => entry.type);
  const states = () => harness.observer.sent.flatMap(event => (event.type === 'conversation.state' ? [event.state] : []));
  return { ...harness, useCase, entries, types, states };
}

describe('SendConversationMessageUseCase', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('user message', () => {
    it('records the message and renames the conversation after its first line, cut at 60 characters', async () => {
      const { useCase, store, observer } = setup();

      await useCase.execute('web-1', `\n  ${'a'.repeat(80)}\nsecond line`);

      expect(store.conversations.get('web-1')?.title).toBe('a'.repeat(60));
      expect(observer.sent).toContainEqual({
        type: 'conversation.updated',
        conversation: expect.objectContaining({ id: 'web-1', title: 'a'.repeat(60) }),
      });
    });

    it('keeps the title after the first message and only touches the conversation', async () => {
      const { useCase, store } = setup();

      await useCase.execute('web-1', 'first');
      await useCase.execute('web-1', 'second');

      expect(store.conversations.get('web-1')?.title).toBe('first');
    });
  });

  describe('attachments', () => {
    const attachment = { path: '.arc-uploads/web-1/shot.png', name: 'shot.png' };

    it('records the attachments on the user message and hands the orchestrator the files, as a channel does', async () => {
      const { useCase, uploads, agentTurn, entries } = setup();
      uploads.files.set(attachment.path, 2048);

      await useCase.execute('web-1', 'look at this', [attachment]);

      expect(entries()[0]).toMatchObject({ type: 'user_message', text: 'look at this', attachments: [attachment] });
      expect(agentTurn.turnRequests[0]).toMatchObject({
        prompt: 'look at this',
        attachments: [{ name: 'shot.png', path: '/workspaces/.arc-uploads/web-1/shot.png', contentType: 'image/png', size: 2048 }],
      });
    });

    it('leaves the text untouched for the orchestrator when the message has only attachments', async () => {
      const { useCase, uploads, agentTurn } = setup();
      uploads.files.set(attachment.path, 1);

      await useCase.execute('web-1', '', [attachment]);

      expect(agentTurn.turnRequests[0].prompt).toBe('');
    });

    it('sends a message without attachments with an empty attachment list', async () => {
      const { useCase, agentTurn } = setup();

      await useCase.execute('web-1', 'plain');

      expect(agentTurn.turnRequests[0].attachments).toEqual([]);
    });

    it('shows what the orchestrator transcribed, and could not transcribe, as notices', async () => {
      const { useCase, uploads, agentTurn, entries } = setup();
      uploads.files.set('.arc-uploads/web-1/voice.ogg', 10);
      agentTurn.turnBehavior = request => request.onTranscription?.({
        transcripts: [{ name: 'voice.ogg', text: 'build a page' }],
        warnings: ['⚠️ No speech was detected in "other.ogg"'],
      });

      await useCase.execute('web-1', '', [{ path: '.arc-uploads/web-1/voice.ogg', name: 'voice.ogg' }]);

      expect(entries()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'notice', level: 'warning', text: '⚠️ No speech was detected in "other.ogg"' }),
        expect.objectContaining({ type: 'notice', level: 'info', text: '🎙️ voice.ogg: build a page' }),
      ]));
    });

    it('accepts a message with attachments and no text, titling the conversation after the first file', async () => {
      const { useCase, uploads, store, promptHistory } = setup();
      uploads.files.set(attachment.path, 1);

      await useCase.execute('web-1', '', [attachment]);

      expect(store.conversations.get('web-1')?.title).toBe('shot.png');
      expect(promptHistory.prompts).toEqual([]);
    });

    it.each([
      ['a file that is gone', '.arc-uploads/web-1/shot.png', false],
      ['a file of another conversation', '.arc-uploads/web-2/shot.png', true],
      ['a path that climbs out of the upload directory', '.arc-uploads/web-1/../../secret', true],
    ])('refuses %s, running no turn', async (_label, path, exists) => {
      const { useCase, uploads, agentTurn, entries } = setup();
      if (exists) {
        uploads.files.set(path, 1);
      }

      await useCase.execute('web-1', 'hello', [{ path, name: 'x' }]);

      expect(agentTurn.turnRequests).toHaveLength(0);
      expect(entries()).toEqual([expect.objectContaining({ type: 'notice', level: 'error', text: expect.stringContaining('attached file is missing') })]);
    });
  });

  describe('prompt history', () => {
    it('records each accepted prompt, most recent first', async () => {
      const { useCase, promptHistory } = setup();

      await useCase.execute('web-1', 'first');
      await useCase.execute('web-1', 'second');

      expect(promptHistory.prompts).toEqual(['second', 'first']);
    });

    it('records nothing while the conversation is not configured', async () => {
      const { useCase, configuration, promptHistory } = setup();
      configuration.store.byConversation.clear();

      await useCase.execute('web-1', 'hello');

      expect(promptHistory.prompts).toEqual([]);
    });
  });

  describe('configuration', () => {
    it('refuses to run, and records nothing, while the conversation has no agent settings', async () => {
      const { useCase, agentTurn, configuration, entries, states } = setup();
      configuration.store.byConversation.clear();

      await useCase.execute('web-1', 'hello');

      expect(entries()).toEqual([expect.objectContaining({ type: 'notice', level: 'warning', text: expect.stringContaining('Choose an agent') })]);
      expect(agentTurn.turnRequests).toHaveLength(0);
      expect(states()).toEqual([]);
    });

    it('runs with the default agent when no agent is installed', async () => {
      const { useCase, agentTurn, configuration } = setup();
      configuration.store.byConversation.clear();
      configuration.agents = [];

      await useCase.execute('web-1', 'hello');

      expect(agentTurn.turnRequests).toHaveLength(1);
    });

    it('runs with settings inherited from the most recent conversation', async () => {
      const { useCase, agentTurn, configuration } = setup();
      configuration.store.byConversation.clear();
      configuration.store.byConversation.set('other', configuredSettings());

      await useCase.execute('web-1', 'hello');

      expect(agentTurn.turnRequests).toHaveLength(1);
      expect(await configuration.store.load('web-1')).not.toBeNull();
    });
  });

  describe('turn execution', () => {
    it('runs the turn as the CEO in the workspace and publishes running, the response and idle', async () => {
      const { useCase, agentTurn, types, states, store } = setup();
      agentTurn.turnResult = { response: 'finished', status: 'completed' };

      await useCase.execute('web-1', 'do it');

      expect(agentTurn.turnRequests[0]).toMatchObject({
        conversationId: 'web-1',
        userId: 'web-local',
        prompt: 'do it',
        workspacePath: '/workspaces',
        agentRole: 'CEO',
      });
      expect(types()).toEqual(['user_message', 'agent_response']);
      expect(states()).toEqual(['running', 'idle']);
      expect(store.flushed).toEqual(['web-1']);
    });

    it('maps activities, delegations, interim messages and questions to entries', async () => {
      const { useCase, agentTurn, types } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking' });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'in_progress' });
        request.onActivity?.({ kind: 'steering', id: 's1', text: 'ignored' });
        request.onDelegation?.({ phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer' });
        request.onInterimMessage?.('working');
        request.onQuestion?.(prompt);
      };

      await useCase.execute('web-1', 'go');

      expect(types()).toEqual(['user_message', 'thought', 'tool', 'delegation', 'interim', 'question', 'agent_response']);
    });

    it('publishes the response being written as a draft, replaced by the final response', async () => {
      const { useCase, agentTurn, events, observer } = setup();
      const seen: string[] = [];
      agentTurn.turnBehavior = async (request) => {
        request.onDraft?.('Working');
        request.onDraft?.('Working on it');
        seen.push(events.draftOf('web-1'));
      };

      await useCase.execute('web-1', 'go');

      expect(seen).toEqual(['Working on it']);
      expect(events.draftOf('web-1')).toBe('');
      expect(observer.sent.map(event => (event.type === 'conversation.draft' ? `draft:${event.text}` : event.type))).toEqual([
        'conversation.entry',
        'conversation.updated',
        'conversation.state',
        'draft:Working',
        'draft:Working on it',
        'draft:',
        'conversation.entry',
        'conversation.state',
      ]);
    });

    it('returns to running when a draft is the first output after queueing', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onQueued?.();
        request.onDraft?.('Hi');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'queued', 'running', 'idle']);
    });

    it('updates a streamed thought and a tool in place by id', async () => {
      const { useCase, agentTurn, entries } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'th' });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'in_progress' });
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking' });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'completed' });
        request.onActivity?.({ kind: 'thought', id: 't1', text: '', removed: true });
      };

      await useCase.execute('web-1', 'go');

      const [, thought, tool] = entries();
      expect(entries()).toHaveLength(4);
      expect(thought).toMatchObject({ id: 'thought:t1', removed: true });
      expect(tool).toMatchObject({ id: 'tool:c1', status: 'completed' });
    });

    it('publishes queued and returns to running once the turn produces output', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onQueued?.();
        request.onInterimMessage?.('started');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'queued', 'running', 'idle']);
    });

    it('does not repeat the running state while output keeps arriving', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onInterimMessage?.('a');
        request.onInterimMessage?.('b');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'idle']);
    });

    it('leaves the state to the running turn when the prompt was steered into it', async () => {
      const { useCase, agentTurn, states, entries, store } = setup();
      agentTurn.turnResult = { response: '', status: 'steered' };

      await useCase.execute('web-1', 'also this');

      expect(entries().at(-1)).toMatchObject({ type: 'agent_response', status: 'steered' });
      expect(states()).not.toContain('idle');
      expect(store.flushed).toEqual([]);
    });

    it('publishes a failed turn result and returns to idle', async () => {
      const { useCase, agentTurn, entries, states } = setup();
      agentTurn.turnResult = { response: '', status: 'failed', errorMessage: 'boom' };

      await useCase.execute('web-1', 'go');

      expect(entries().at(-1)).toMatchObject({ status: 'failed', errorMessage: 'boom' });
      expect(states().at(-1)).toBe('idle');
    });
  });

  describe('errors', () => {
    it('reports a thrown turn as an error notice and returns to idle', async () => {
      const { useCase, agentTurn, entries, states } = setup();
      agentTurn.turnError = new Error('agent crashed');

      await expect(useCase.execute('web-1', 'go')).resolves.toBeUndefined();

      expect(entries().at(-1)).toMatchObject({
        type: 'notice',
        level: 'error',
        text: expect.stringContaining('agent crashed'),
      });
      expect(states()).toEqual(['running', 'idle']);
    });

    it('reports a failure before the turn without changing the state', async () => {
      const { useCase, configuration, entries, states } = setup();
      vi.spyOn(configuration, 'ensureSettings').mockRejectedValue('plain failure');

      await useCase.execute('web-1', 'go');

      expect(entries().at(-1)).toMatchObject({ type: 'notice', level: 'error', text: expect.stringContaining('plain failure') });
      expect(states()).toEqual([]);
    });

    it('survives a flush failure at the end of the turn', async () => {
      const { useCase, store } = setup();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      vi.spyOn(store, 'flush').mockRejectedValue(new Error('disk full'));

      await expect(useCase.execute('web-1', 'go')).resolves.toBeUndefined();
    });

    it('describes a non-Error flush failure', async () => {
      const { useCase, store } = setup();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      vi.spyOn(store, 'flush').mockRejectedValue('nope');

      await useCase.execute('web-1', 'go');
      await Promise.resolve();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    });
  });
});
