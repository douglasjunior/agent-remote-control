import { Logger } from '@nestjs/common';

import { currentLogConversation } from '../../logging/utils/log-conversation.util.js';
import { WebAccessTokenService } from '../services/web-access-token.service.js';
import { WebAgentQuotaService } from '../services/web-agent-quota.service.js';
import { WebConversationUploadsService } from '../services/web-conversation-uploads.service.js';
import { WebFileSearchSessionsService } from '../services/web-file-search-sessions.service.js';
import { WebUploadSessionsService } from '../services/web-upload-sessions.service.js';
import { configuredSettings } from '../testing/configured-settings.js';
import { FakeClientConnection, FakeClientTransport } from '../testing/fake-client-connection.js';
import { createWebHarness } from '../testing/web-harness.js';
import { AnswerConversationQuestionUseCase } from '../use-cases/answer-conversation-question.use-case.js';
import { CancelConversationTurnUseCase } from '../use-cases/cancel-conversation-turn.use-case.js';
import { CreateConversationUseCase } from '../use-cases/create-conversation.use-case.js';
import { GetConversationHistoryUseCase } from '../use-cases/get-conversation-history.use-case.js';
import { GetConversationProfilesUseCase } from '../use-cases/get-conversation-profiles.use-case.js';
import { ListAgentOptionsUseCase } from '../use-cases/list-agent-options.use-case.js';
import { ListConversationsUseCase } from '../use-cases/list-conversations.use-case.js';
import { ListPromptHistoryUseCase } from '../use-cases/list-prompt-history.use-case.js';
import { ResumeConversationWorkUseCase } from '../use-cases/resume-conversation-work.use-case.js';
import { SendConversationMessageUseCase } from '../use-cases/send-conversation-message.use-case.js';
import { SetConversationProfilesUseCase } from '../use-cases/set-conversation-profiles.use-case.js';

import { AUTH_FAILED_CLOSE_CODE, AUTH_TIMEOUT_MS, WebConnectionHandler } from './web-connection.handler.js';


const OBSERVER_ONLY = 1;
const OBSERVER_AND_CLIENT = 2;

describe('WebConnectionHandler', () => {
  let transport: FakeClientTransport;
  let harness: ReturnType<typeof createWebHarness>;
  let handler: WebConnectionHandler;
  let connection: FakeClientConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    transport = new FakeClientTransport();
    harness = createWebHarness();
    const { store, events, agentTurn, configuration, questions, workspace, promptHistory, fileSearch, uploads } = harness;
    const getProfiles = new GetConversationProfilesUseCase(configuration);
    const conversationUploads = new WebConversationUploadsService(workspace, uploads);
    const sendMessage = new SendConversationMessageUseCase(agentTurn, configuration, events, store, workspace, promptHistory, conversationUploads, harness.turns);
    const resumeWork = new ResumeConversationWorkUseCase(agentTurn, workspace, events, harness.turns);
    handler = new WebConnectionHandler(
      transport,
      store,
      new WebAccessTokenService(),
      harness.registry,
      events,
      new ListConversationsUseCase(store),
      new CreateConversationUseCase(store),
      new GetConversationHistoryUseCase(store, events, questions, agentTurn),
      sendMessage,
      new CancelConversationTurnUseCase(agentTurn, events),
      new ListAgentOptionsUseCase(configuration),
      getProfiles,
      new SetConversationProfilesUseCase(configuration, getProfiles, events),
      new AnswerConversationQuestionUseCase(questions, events, resumeWork, conversationUploads),
      resumeWork,
      new ListPromptHistoryUseCase(promptHistory),
      new WebFileSearchSessionsService(fileSearch),
      new WebUploadSessionsService(uploads),
      new WebAgentQuotaService(agentTurn),
    );
    handler.onModuleInit();
    connection = new FakeClientConnection();
    transport.connect(connection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('authenticates a correct token and registers the connection', () => {
    connection.receive({ type: 'auth', token: 'secret' });

    expect(connection.sent).toEqual([{ type: 'auth.ok' }]);
    expect(harness.registry.size).toBe(OBSERVER_AND_CLIENT);
  });

  it('does not close an authenticated connection when the timeout elapses', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.closedWith).toBeUndefined();
  });

  it('rejects a wrong token with close code 4401', () => {
    connection.receive({ type: 'auth', token: 'wrong' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
    expect(harness.registry.size).toBe(OBSERVER_ONLY);
  });

  it('rejects when no auth command arrives in time', () => {
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it('rejects any other first command without routing it', () => {
    connection.receive({ type: 'conversation.list' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it('ignores messages received after a rejection', () => {
    connection.receive({ type: 'auth', token: 'wrong' });
    connection.receive({ type: 'auth', token: 'secret' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(harness.registry.size).toBe(OBSERVER_ONLY);
  });

  it('cancels the timeout when the connection closes', () => {
    connection.simulateClose();
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.sent).toEqual([]);
  });

  it('answers an invalid command from an authenticated connection with an error', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    connection.receive({ type: 'nope' });

    expect(connection.sent[1]).toEqual({ type: 'error', message: 'Invalid command' });
    expect(connection.closedWith).toBeUndefined();
  });

  describe('routing after authentication', () => {
    const settle = async () => {
      for (let pass = 0; pass < 10; pass += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    const sent = () => connection.sent.slice(1);

    beforeEach(() => {
      connection.receive({ type: 'auth', token: 'secret' });
    });

    it('answers quota.get to the requester with the reports and their time', async () => {
      const reports = [{ agent: { id: 'cursor', name: 'Cursor' }, status: 'unsupported' as const }];
      harness.agentTurn.quotaReports = reports;

      connection.receive({ type: 'quota.get' });
      await settle();

      expect(sent()).toEqual([{ type: 'quota.report', reports, fetchedAt: new Date().toISOString() }]);
    });

    it('passes the refresh of quota.get on, ignoring the reports it remembers', async () => {
      connection.receive({ type: 'quota.get' });
      await settle();
      const reports = [{ agent: { id: 'cursor', name: 'Cursor' }, status: 'failed' as const }];
      harness.agentTurn.quotaReports = reports;

      connection.receive({ type: 'quota.get', refresh: true });
      await settle();

      expect(sent().at(-1)).toMatchObject({ type: 'quota.report', reports });
    });

    it('answers quota.failed, never an error event, when the usage cannot be read', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      harness.agentTurn.throwOnQuota = true;

      connection.receive({ type: 'quota.get' });
      await settle();

      expect(sent()).toEqual([{ type: 'quota.failed' }]);
      expect(warn).toHaveBeenCalledWith('quota_failed: quota down');
      warn.mockRestore();
    });

    it('answers conversation.list to the requester', async () => {
      harness.store.seed('web-1');

      connection.receive({ type: 'conversation.list' });
      await settle();

      expect(sent()).toEqual([{ type: 'conversation.list', conversations: [expect.objectContaining({ id: 'web-1' })] }]);
    });

    it('answers conversation.create to the requester and tells the others', async () => {
      const other = new FakeClientConnection('other');
      transport.connect(other);
      other.receive({ type: 'auth', token: 'secret' });

      connection.receive({ type: 'conversation.create', requestId: 'r1' });
      await settle();

      expect(sent()).toEqual([{ type: 'conversation.created', requestId: 'r1', conversation: expect.objectContaining({ id: 'web-1' }) }]);
      expect(other.sent).toContainEqual({ type: 'conversation.updated', conversation: expect.objectContaining({ id: 'web-1' }) });
    });

    it('answers prompts.history with the stored prompts, most recent first', async () => {
      await harness.promptHistory.append('older');
      await harness.promptHistory.append('latest');
      connection.sent.length = 0;

      connection.receive({ type: 'prompts.history', requestId: 'r1' });
      await settle();

      expect(connection.sent).toEqual([{ type: 'prompts.list', requestId: 'r1', prompts: ['latest', 'older'] }]);
    });

    it('streams files.results for files.search and only changes the query on the same request id', async () => {
      connection.sent.length = 0;

      connection.receive({ type: 'files.search', requestId: 'r2', query: 'src' });
      connection.receive({ type: 'files.search', requestId: 'r2', query: 'srcx' });
      await settle();
      harness.fileSearch.sessions[0].emit([{ path: 'app/src/', kind: 'directory', matches: [0] }]);

      expect(harness.fileSearch.sessions).toHaveLength(1);
      expect(harness.fileSearch.sessions[0].queries).toEqual(['src', 'srcx']);
      expect(connection.sent.at(-1)).toEqual({
        type: 'files.results',
        requestId: 'r2',
        items: [{ path: 'app/src/', kind: 'directory', matches: [0] }],
        walking: true,
      });
    });

    it('stops the file search on files.close and when the connection closes', async () => {
      connection.receive({ type: 'files.search', requestId: 'r2', query: '' });
      connection.receive({ type: 'files.close', requestId: 'r2' });
      connection.receive({ type: 'files.search', requestId: 'r3', query: '' });
      await settle();
      connection.simulateClose();

      expect(harness.fileSearch.sessions.map(session => session.stopped)).toEqual([true, true]);
    });

    it('uploads a file in chunks through upload.start, upload.chunk and upload.finish', async () => {
      harness.store.seed('web-1');
      connection.sent.length = 0;

      connection.receive({ type: 'upload.start', uploadId: 'u1', conversationId: 'web-1', name: 'a.txt', size: 2 });
      await settle();
      connection.receive({ type: 'upload.chunk', uploadId: 'u1', index: 0, dataBase64: Buffer.from('hi').toString('base64') });
      await settle();
      connection.receive({ type: 'upload.finish', uploadId: 'u1' });
      await settle();

      expect(connection.sent).toEqual([
        { type: 'upload.ready', uploadId: 'u1' },
        { type: 'upload.ack', uploadId: 'u1', index: 0 },
        { type: 'upload.done', uploadId: 'u1', attachment: { path: '.arc-uploads/web-1/a.txt', name: 'a.txt' } },
      ]);
    });

    it('refuses upload.start for an unknown conversation', async () => {
      connection.sent.length = 0;

      connection.receive({ type: 'upload.start', uploadId: 'u1', conversationId: 'ghost', name: 'a.txt', size: 2 });
      await settle();

      expect(connection.sent).toEqual([{ type: 'error', message: 'Unknown conversation', conversationId: 'ghost' }]);
      expect(harness.uploads.writers).toHaveLength(0);
    });

    it('discards the upload on upload.abort and when the connection closes', async () => {
      harness.store.seed('web-1');
      connection.receive({ type: 'upload.start', uploadId: 'u1', conversationId: 'web-1', name: 'a.txt', size: 2 });
      connection.receive({ type: 'upload.start', uploadId: 'u2', conversationId: 'web-1', name: 'b.txt', size: 2 });
      await settle();

      connection.receive({ type: 'upload.abort', uploadId: 'u1' });
      await settle();
      connection.simulateClose();
      await settle();

      expect(harness.uploads.writers.map(writer => writer.aborted)).toEqual([true, true]);
    });

    it('sends message.send attachments to the use case', async () => {
      harness.store.seed('web-1');
      harness.configuration.store.byConversation.set('web-1', configuredSettings());
      harness.uploads.files.set('.arc-uploads/web-1/a.png', 5);

      connection.receive({ type: 'message.send', conversationId: 'web-1', text: '', attachments: [{ path: '.arc-uploads/web-1/a.png', name: 'a.png' }] });
      await settle();

      expect(harness.agentTurn.turnRequests[0].attachments).toEqual([expect.objectContaining({ name: 'a.png', path: '/workspaces/.arc-uploads/web-1/a.png', contentType: 'image/png', size: 5 })]);
    });

    it('answers conversation.history with the entries and the state', async () => {
      harness.store.seed('web-1');
      harness.events.publishState('web-1', 'running');
      connection.sent.length = 0;

      connection.receive({ type: 'conversation.history', conversationId: 'web-1' });
      await settle();

      expect(connection.sent).toContainEqual({
        type: 'conversation.history',
        conversationId: 'web-1',
        interrupted: [],
        entries: [],
        state: 'running',
      });
    });

    it('includes the response being written in conversation.history', async () => {
      harness.store.seed('web-1');
      harness.events.publishDraft('web-1', 'Working on');
      connection.sent.length = 0;

      connection.receive({ type: 'conversation.history', conversationId: 'web-1' });
      await settle();

      expect(connection.sent).toContainEqual(expect.objectContaining({ type: 'conversation.history', draft: 'Working on' }));
    });

    it('starts a turn for message.send without waiting for it', async () => {
      harness.store.seed('web-1');
      harness.configuration.store.byConversation.set('web-1', configuredSettings());

      connection.receive({ type: 'message.send', conversationId: 'web-1', text: 'hello' });
      await settle();

      expect(harness.agentTurn.turnRequests).toHaveLength(1);
      expect(connection.sent).toContainEqual(expect.objectContaining({ type: 'conversation.entry' }));
    });

    it('cancels a turn', async () => {
      harness.store.seed('web-1');
      harness.agentTurn.cancelResult = false;

      connection.receive({ type: 'turn.cancel', conversationId: 'web-1' });
      await settle();

      expect(connection.sent).toContainEqual(expect.objectContaining({ type: 'conversation.entry' }));
    });

    it('lists the agents, then the models and efforts of an agent', async () => {
      connection.receive({ type: 'agents.list' });
      connection.receive({ type: 'models.list', agentId: 'codex' });
      connection.receive({ type: 'efforts.list', agentId: 'codex', modelId: 'gpt' });
      await settle();

      expect(sent()).toEqual([
        { type: 'agents.list', agents: [{ id: 'codex', name: 'Codex' }] },
        { type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT', description: 'Fast' }] },
        { type: 'efforts.list', agentId: 'codex', modelId: 'gpt', efforts: [{ id: 'high', name: 'High' }] },
      ]);
    });

    it('answers the models and efforts of an unknown agent with an error', async () => {
      connection.receive({ type: 'models.list', agentId: 'ghost' });
      connection.receive({ type: 'efforts.list', agentId: 'ghost', modelId: 'gpt' });
      await settle();

      expect(sent()).toEqual([{ type: 'error', message: 'Unknown agent' }, { type: 'error', message: 'Unknown agent' }]);
    });

    it('answers profiles.get to the requester with the conversation profiles', async () => {
      harness.store.seed('web-1');

      connection.receive({ type: 'profiles.get', conversationId: 'web-1' });
      await settle();

      expect(sent()).toEqual([{ type: 'profiles', conversationId: 'web-1', configured: false, profiles: expect.any(Array) }]);
    });

    it('saves profiles and lets every connection know', async () => {
      harness.store.seed('web-1');

      connection.receive({ type: 'profiles.set', conversationId: 'web-1', agentId: 'codex', modelId: 'gpt' });
      await settle();

      expect(harness.configuration.configureCalls).toHaveLength(1);
      expect(sent()).toEqual([{ type: 'profiles', conversationId: 'web-1', configured: true, profiles: expect.any(Array) }]);
    });

    it('answers an invalid profiles.set with an error', async () => {
      harness.store.seed('web-1');
      harness.configuration.configureResult = { ok: false, error: 'Unknown agent' };

      connection.receive({ type: 'profiles.set', conversationId: 'web-1', agentId: 'ghost' });
      await settle();

      expect(sent()).toEqual([{ type: 'error', message: 'Unknown agent', conversationId: 'web-1' }]);
    });

    it('answers a question by option or by text', async () => {
      harness.store.seed('web-1');
      harness.questions.submission = { kind: 'answered', asker: { role: 'CEO', roleName: 'CEO', projectName: null } };

      connection.receive({ type: 'question.answer', conversationId: 'web-1', answer: { kind: 'option', optionIndex: 2 } });
      connection.receive({ type: 'question.answer', conversationId: 'web-1', answer: { kind: 'text', text: 'my own' } });
      await settle();

      expect(harness.questions.answers.map(entry => entry.answer)).toEqual([{ kind: 'option', optionIndex: 2 }, { kind: 'text', text: 'my own' }]);
    });

    it('resumes interrupted work', async () => {
      harness.store.seed('web-1');
      harness.agentTurn.interruptedWork = [{ id: 'w', role: 'DEVELOPER', roleName: 'Developer', projectName: null, summary: 'Build' }];

      connection.receive({ type: 'work.resume', conversationId: 'web-1', workId: 'w' });

      await vi.waitFor(() => expect(harness.agentTurn.resumedWorkIds).toEqual(['w']));
    });

    it('rejects an answer when no question is waiting', async () => {
      harness.store.seed('web-1');

      connection.receive({ type: 'question.answer', conversationId: 'web-1', answer: { kind: 'option', optionIndex: 1 } });
      await settle();

      expect(sent()).toEqual([{ type: 'error', message: 'There is no open question', conversationId: 'web-1' }]);
    });

    it('logs the command and its rejection under the conversation, without what the user wrote', async () => {
      harness.store.seed('web-1');
      const logged: (readonly [string, string | undefined])[] = [];
      const record = (message: unknown) => {
        logged.push([String(message), currentLogConversation()]);
      };
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(record);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(record);

      connection.receive({ type: 'question.answer', conversationId: 'web-1', answer: { kind: 'text', text: 'private words' } });
      await settle();
      log.mockRestore();
      warn.mockRestore();

      expect(logged).toEqual([
        ['[Command] question.answer', 'web-1'],
        ['[Command Rejected] There is no open question', 'web-1'],
      ]);
    });

    it('answers a command for an unknown conversation with an error', async () => {
      connection.receive({ type: 'message.send', conversationId: 'web-missing', text: 'hi' });
      await settle();

      expect(sent()).toEqual([{ type: 'error', message: 'Unknown conversation', conversationId: 'web-missing' }]);
      expect(harness.agentTurn.turnRequests).toHaveLength(0);
    });

    it('ignores a repeated auth command', async () => {
      connection.receive({ type: 'auth', token: 'secret' });
      await settle();

      expect(sent()).toEqual([]);
    });

    it('reports a failing command without closing the connection', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.spyOn(harness.store, 'list').mockRejectedValue(new Error('disk gone'));
      connection.receive({ type: 'conversation.list' });
      await settle();

      expect(sent()).toEqual([{ type: 'error', message: 'The command failed' }]);
      expect(connection.closedWith).toBeUndefined();
    });

    it('describes a command that fails with a non-Error value', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.spyOn(harness.store, 'list').mockRejectedValue('plain');
      connection.receive({ type: 'conversation.list' });
      await settle();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('plain'));
    });
  });

  it('stops listening for connections on module destroy', () => {
    handler.onModuleDestroy();

    expect(transport.listenerCount).toBe(0);
  });
});
