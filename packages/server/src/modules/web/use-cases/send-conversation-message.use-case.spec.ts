import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Logger } from '@nestjs/common';
import { rs } from '@rstest/core';

import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { WebConversationUploadsService } from '../services/web-conversation-uploads.service.js';
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
    harness.turnRetry,
    harness.events,
    harness.store,
    harness.workspace,
    harness.promptHistory,
    new WebConversationUploadsService(harness.workspace, harness.uploads),
    harness.turns,
    new ConversationEntryService(),
  );
  const entries = (): ConversationEntry[] => harness.store.histories.get('web-1') ?? [];
  const types = () => entries().map(entry => entry.type);
  const states = () => harness.observer.sent.flatMap(event => (event.type === 'conversation.state' ? [event.state] : []));
  return { ...harness, useCase, entries, types, states };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SendConversationMessageUseCase', () => {
  beforeEach(() => {
    rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  describe('user message', () => {
    it('should record the message and rename the conversation after its first line, cut at 60 characters', async () => {
      const { useCase, store, observer } = setup();

      await useCase.execute('web-1', `\n  ${'a'.repeat(80)}\nsecond line`);

      expect(store.conversations.get('web-1')?.title).toBe('a'.repeat(60));
      expect(observer.sent).toContainEqual({
        type: 'conversation.updated',
        conversation: expect.objectContaining({ id: 'web-1', title: 'a'.repeat(60) }),
      });
    });

    it('should keep the title after the first message and only touches the conversation', async () => {
      const { useCase, store } = setup();

      await useCase.execute('web-1', 'first');
      await useCase.execute('web-1', 'second');

      expect(store.conversations.get('web-1')?.title).toBe('first');
    });
  });

  describe('attachments', () => {
    const attachment = { path: '.arc-uploads/web-1/shot.png', name: 'shot.png' };

    it('should record the attachments on the user message and hand the orchestrator the files, as a channel does', async () => {
      const { useCase, uploads, agentTurn, entries } = setup();
      uploads.files.set(attachment.path, 2048);

      await useCase.execute('web-1', 'look at this', [attachment]);

      expect(entries()[0]).toMatchObject({ type: 'user_message', text: 'look at this', attachments: [attachment] });
      expect(agentTurn.turnRequests[0]).toMatchObject({
        prompt: 'look at this',
        attachments: [{ name: 'shot.png', path: '/workspaces/.arc-uploads/web-1/shot.png', contentType: 'image/png', size: 2048 }],
      });
    });

    it('should leave the text untouched for the orchestrator when the message has only attachments', async () => {
      const { useCase, uploads, agentTurn } = setup();
      uploads.files.set(attachment.path, 1);

      await useCase.execute('web-1', '', [attachment]);

      expect(agentTurn.turnRequests[0].prompt).toBe('');
    });

    it('should send a message without attachments with an empty attachment list', async () => {
      const { useCase, agentTurn } = setup();

      await useCase.execute('web-1', 'plain');

      expect(agentTurn.turnRequests[0].attachments).toEqual([]);
    });

    it('should show what the orchestrator transcribed, and could not transcribe, as notices', async () => {
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

    it('should accept a message with attachments and no text, titling the conversation after the first file', async () => {
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
    ])('should refuse %s, running no turn', async (_label, path, exists) => {
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
    it('should record each accepted prompt, most recent first', async () => {
      const { useCase, promptHistory } = setup();

      await useCase.execute('web-1', 'first');
      await useCase.execute('web-1', 'second');

      expect(promptHistory.prompts).toEqual(['second', 'first']);
    });

    it('should record nothing while the conversation is not configured', async () => {
      const { useCase, configuration, promptHistory } = setup();
      configuration.store.byConversation.clear();

      await useCase.execute('web-1', 'hello');

      expect(promptHistory.prompts).toEqual([]);
    });
  });

  describe('configuration', () => {
    it('should refuse to run, and record nothing, while the conversation has no agent settings', async () => {
      const { useCase, agentTurn, configuration, entries, states } = setup();
      configuration.store.byConversation.clear();

      await useCase.execute('web-1', 'hello');

      expect(entries()).toEqual([expect.objectContaining({ type: 'notice', level: 'warning', text: expect.stringContaining('Choose an agent') })]);
      expect(agentTurn.turnRequests).toHaveLength(0);
      expect(states()).toEqual([]);
    });

    it('should run with the default agent when no agent is installed', async () => {
      const { useCase, agentTurn, configuration } = setup();
      configuration.store.byConversation.clear();
      configuration.agents = [];

      await useCase.execute('web-1', 'hello');

      expect(agentTurn.turnRequests).toHaveLength(1);
    });

    it('should run with settings inherited from the most recent conversation', async () => {
      const { useCase, agentTurn, configuration } = setup();
      configuration.store.byConversation.clear();
      configuration.store.byConversation.set('other', configuredSettings());

      await useCase.execute('web-1', 'hello');

      expect(agentTurn.turnRequests).toHaveLength(1);
      expect(await configuration.store.load('web-1')).not.toBeNull();
    });
  });

  describe('turn execution', () => {
    it('should run the turn as the CEO in the workspace and publish running, the response and idle', async () => {
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

    it('should map activities, delegations, interim messages and questions to entries', async () => {
      const { useCase, agentTurn, types } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking' }, 'CEO');
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'in_progress' }, 'CEO');
        request.onActivity?.({ kind: 'steering', id: 's1', text: 'ignored' }, 'CEO');
        request.onDelegation?.({ phase: 'started', delegationId: 'dl-1', round: 1, role: 'DEVELOPER', roleName: 'Developer', taskSpec: 'Do the work', summary: 'Doing the work' });
        request.onInterimMessage?.('working');
        request.onQuestion?.({ kind: 'asked', prompt });
      };

      await useCase.execute('web-1', 'go');

      expect(types()).toEqual(['user_message', 'thought', 'tool', 'delegation', 'interim', 'question', 'agent_response']);
    });

    describe('when a failed turn waits to be retried', () => {
      const prompt = { roleName: 'CEO', errorMessage: 'Service unavailable', attempt: 1, timeout: { expiresAt: 2_000_000, durationMs: 15_000 } };

      it('should show the failure as a card with the time of the retry, then close it when the wait ends', async () => {
        const context = setup();
        context.agentTurn.turnBehavior = async (request) => {
          request.onRetry?.({ kind: 'scheduled', prompt });
          await rs.waitFor(() => expect(context.types()).toContain('retry'));
          request.onRetry?.({ kind: 'ended', reason: 'elapsed' });
          await rs.waitFor(() => expect(context.entries().find(entry => entry.type === 'retry')).toMatchObject({ closed: true }));
        };

        await context.useCase.execute('web-1', 'go');

        expect(context.entries().find(entry => entry.type === 'retry')).toMatchObject({ errorMessage: 'Service unavailable', attempt: 1, closed: true });
      });

      it('should retry now with the message instead of starting a turn, and record the message', async () => {
        const { useCase, agentTurn, turnRetry, types, entries } = setup();
        turnRetry.pending = true;

        await useCase.execute('web-1', 'I logged in again.');

        expect(turnRetry.retries).toEqual([{ conversationId: 'web-1', message: { text: 'I logged in again.', attachments: [] } }]);
        expect(agentTurn.turnRequests).toHaveLength(0);
        expect(types()).toEqual(['user_message']);
        expect(entries()[0]).toMatchObject({ text: 'I logged in again.' });
      });
    });

    describe('when a question times out', () => {
      const runTimedOut = async (timedOut: Parameters<NonNullable<TurnRequest['onQuestion']>>[0]) => {
        const context = setup();
        let whileRunning: ConversationEntry[] = [];
        context.agentTurn.turnBehavior = async (request) => {
          request.onQuestion?.({ kind: 'asked', prompt });
          request.onQuestion?.(timedOut);
          await rs.waitFor(() => expect(context.types()).toContain('notice'));
          whileRunning = [...context.entries()];
        };
        await context.useCase.execute('web-1', 'go');
        return whileRunning;
      };

      it('should close the open question, report the recommended answer assumed and show the next question', async () => {
        const entries = await runTimedOut({
          kind: 'timedOut',
          asker,
          answered: { question: prompt.question, answer: 'a', optionNumber: 1, timedOut: true },
          timeoutMs: 300_000,
          next: { ...prompt, number: 2 },
        });

        expect(entries.map(entry => entry.type)).toEqual(['user_message', 'question', 'notice', 'question']);
        expect(entries.filter(entry => entry.type === 'question').map(entry => entry.closed)).toEqual([true, false]);
        expect(entries[2]).toMatchObject({ level: 'warning', text: 'No reply in 5 min, Developer: assumed the recommended answer: a.' });
      });

      it('should report that nothing was assumed when the question had no recommendation', async () => {
        const entries = await runTimedOut({
          kind: 'timedOut',
          asker: { ...asker, projectName: 'app' },
          answered: { question: prompt.question, answer: '', timedOut: true },
          timeoutMs: 1_000,
        });

        expect(entries.map(entry => entry.type)).toEqual(['user_message', 'question', 'notice']);
        expect(entries[2]).toMatchObject({ text: 'No reply in 1 min, Developer (app): no answer assumed, the agent decides how to proceed.' });
      });
    });

    it('should publish the response being written as a draft, replaced by the final response', async () => {
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
        'conversation.interrupted',
      ]);
    });

    it('should return to running when a draft is the first output after queueing', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onQueued?.();
        request.onDraft?.('Hi');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'queued', 'running', 'idle']);
    });

    it('should update a streamed thought and a tool in place by id', async () => {
      const { useCase, agentTurn, entries } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'th' }, 'CEO');
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'in_progress' }, 'CEO');
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking' }, 'CEO');
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'completed' }, 'CEO');
        request.onActivity?.({ kind: 'thought', id: 't1', text: '', removed: true }, 'CEO');
      };

      await useCase.execute('web-1', 'go');

      const [, thought, tool] = entries();
      expect(entries()).toHaveLength(4);
      expect(thought).toMatchObject({ type: 'thought', removed: true });
      expect(tool).toMatchObject({ type: 'tool', status: 'completed' });
    });

    describe('across turns', () => {
      const delegating = (delegationId: string) => async (request: TurnRequest) => {
        const event = { delegationId, round: 1, role: 'DEVELOPER', roleName: 'Developer', taskSpec: 'Do the work', summary: 'Doing the work' };
        request.onDelegation?.({ ...event, phase: 'started' });
        request.onDelegation?.({ ...event, phase: 'finished', response: 'done', agentInfo: { roleName: 'Developer', agentName: 'agy' }, durationMs: 5 });
      };

      it('should keep the delegations of two turns that share round and role, each under its own user message', async () => {
        const { useCase, agentTurn, entries } = setup();

        agentTurn.turnBehavior = delegating('dl-a');
        await useCase.execute('web-1', 'first');
        agentTurn.turnBehavior = delegating('dl-b');
        await useCase.execute('web-1', 'second');

        expect(entries().map(entry => (entry.type === 'user_message' ? entry.text : entry.type === 'delegation' ? `${entry.delegationId}:${entry.phase}` : entry.type)))
          .toEqual(['first', 'dl-a:started', 'dl-a:finished', 'agent_response', 'second', 'dl-b:started', 'dl-b:finished', 'agent_response']);
        expect(new Set(entries().map(entry => entry.id)).size).toBe(entries().length);
      });

      it('should keep the thoughts and tools two turns number alike', async () => {
        const { useCase, agentTurn, entries } = setup();
        agentTurn.turnBehavior = async (request) => {
          request.onActivity?.({ kind: 'thought', id: 'synthetic:0', text: 'thinking' }, 'CEO');
          request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'completed' }, 'CEO');
        };

        await useCase.execute('web-1', 'first');
        await useCase.execute('web-1', 'second');

        expect(entries().filter(entry => entry.type === 'thought')).toHaveLength(2);
        expect(entries().filter(entry => entry.type === 'tool')).toHaveLength(2);
        expect(entries().map(entry => entry.type)).toEqual(['user_message', 'thought', 'tool', 'agent_response', 'user_message', 'thought', 'tool', 'agent_response']);
      });
    });

    it('should publish queued and return to running once the turn produces output', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onQueued?.();
        request.onInterimMessage?.('started');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'queued', 'running', 'idle']);
    });

    it('should not repeat the running state while output keeps arriving', async () => {
      const { useCase, agentTurn, states } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onInterimMessage?.('a');
        request.onInterimMessage?.('b');
      };

      await useCase.execute('web-1', 'go');

      expect(states()).toEqual(['running', 'idle']);
    });

    it('should leave the state to the running turn when the prompt was steered into it', async () => {
      const { useCase, agentTurn, states, entries, store } = setup();
      const gate = deferred();
      agentTurn.turnBehavior = async (request) => {
        if (request.prompt === 'first') {
          await gate.promise;
        }
      };
      const first = useCase.execute('web-1', 'first');
      await rs.waitFor(() => expect(agentTurn.turnRequests).toHaveLength(1));
      agentTurn.turnResult = { response: '', status: 'steered' };

      await useCase.execute('web-1', 'also this');

      expect(entries().at(-1)).toMatchObject({ type: 'agent_response', status: 'steered' });
      expect(states()).toEqual(['running']);
      expect(store.flushed).toEqual([]);
      gate.resolve();
      await first;
    });

    it('should publish idle only when the last of two overlapping turns ends', async () => {
      const { useCase, agentTurn, states, store } = setup();
      const gates = [deferred(), deferred()];
      let started = 0;
      agentTurn.turnBehavior = async (request) => {
        const gate = gates[started];
        started += 1;
        if (started === 2) {
          request.onQueued?.();
        }
        await gate.promise;
      };

      const first = useCase.execute('web-1', 'first');
      await rs.waitFor(() => expect(started).toBe(1));
      const second = useCase.execute('web-1', 'second');
      await rs.waitFor(() => expect(started).toBe(2));
      gates[1].resolve();
      await second;
      expect(states()).toEqual(['running']);
      expect(store.flushed).toEqual([]);

      gates[0].resolve();
      await first;
      expect(states()).toEqual(['running', 'idle']);
      await rs.waitFor(() => expect(store.flushed).toEqual(['web-1']));
    });

    it('should close the question still open when the conversation goes idle', async () => {
      const { useCase, agentTurn, entries } = setup();
      agentTurn.turnBehavior = async (request) => {
        request.onQuestion?.({ kind: 'asked', prompt });
      };

      await useCase.execute('web-1', 'go');

      await rs.waitFor(() => expect(entries().find(entry => entry.type === 'question')).toMatchObject({ closed: true }));
    });

    it('should publish a failed turn result and return to idle', async () => {
      const { useCase, agentTurn, entries, states } = setup();
      agentTurn.turnResult = { response: '', status: 'failed', errorMessage: 'boom' };

      await useCase.execute('web-1', 'go');

      expect(entries().at(-1)).toMatchObject({ status: 'failed', errorMessage: 'boom' });
      expect(states().at(-1)).toBe('idle');
    });
  });

  describe('errors', () => {
    it('should report a thrown turn as an error notice and return to idle', async () => {
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

    it('should report a failure before the turn without changing the state', async () => {
      const { useCase, configuration, entries, states } = setup();
      rs.spyOn(configuration, 'ensureSettings').mockRejectedValue('plain failure');

      await useCase.execute('web-1', 'go');

      expect(entries().at(-1)).toMatchObject({ type: 'notice', level: 'error', text: expect.stringContaining('plain failure') });
      expect(states()).toEqual([]);
    });
  });
});
