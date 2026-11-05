import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { audioInput, FakeMediaDevices } from '../test/fake-media-devices.js';
import { AT, openConversation, renderApp, userEntry } from '../test/render-app.js';


describe('ConversationView', () => {
  it('requests history, profiles and agents when opened', () => {
    const { connection } = openConversation();
    expect(connection.sent).toContainEqual({ type: 'conversation.history', conversationId: 'c1' });
    expect(connection.sent).toContainEqual({ type: 'profiles.get', conversationId: 'c1' });
    expect(connection.sent).toContainEqual({ type: 'agents.list' });
  });

  it('shows the title and the restored history', () => {
    openConversation({ entries: [userEntry('u1', 'hello there')] });
    expect(screen.getByRole('heading', { name: 'My task' })).toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('falls back to a generic title for an unknown conversation', () => {
    openConversation();
    expect(screen.getByRole('heading', { name: 'My task' })).toBeInTheDocument();
  });

  it('upserts streamed entries in place', () => {
    const { connection } = openConversation();
    act(() => {
      connection.emitEvent({ type: 'conversation.entry', conversationId: 'c1', entry: { id: 'i1', at: AT, type: 'interim', text: 'draft' } });
      connection.emitEvent({ type: 'conversation.entry', conversationId: 'c1', entry: userEntry('u1', 'after') });
      connection.emitEvent({ type: 'conversation.entry', conversationId: 'c1', entry: { id: 'i1', at: AT, type: 'interim', text: 'final' } });
    });
    expect(screen.queryByText('draft')).not.toBeInTheDocument();
    expect(screen.getByText('final')).toBeInTheDocument();
    expect(screen.getByText('after')).toBeInTheDocument();
  });

  it('groups activity into a collapsed section labeled by progress', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({
      entries: [
        { id: 't1', at: AT, type: 'thought', role: 'CEO', text: 'thinking hard' },
        { id: 't2', at: AT, type: 'thought', role: 'CEO', text: 'hidden', removed: true },
        { id: 'x1', at: AT, type: 'tool', role: 'CEO', title: 'Read file', status: 'completed' },
        { id: 'x2', at: AT, type: 'tool', role: 'CEO', title: 'Run tests', status: 'failed' },
        { id: 'x3', at: AT, type: 'tool', role: 'CEO', title: 'Lint', status: 'in_progress' },
      ],
    });
    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

    const trigger = screen.getByRole('button', { name: /Coordinator.*Running project commands….*\(4 steps\)/ });
    expect(screen.queryByText('Reading files')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByTitle('Read file')).toBeInTheDocument();
    expect(screen.getByText('thinking hard')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(screen.getByLabelText('completed')).toBeInTheDocument();
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
    expect(screen.getByLabelText('running')).toBeInTheDocument();

    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'idle' }));
    expect(screen.getByRole('button', { name: /Coordinator.*Show details.*\(4 steps\)/ })).toBeInTheDocument();
  });

  it('uses the singular for a single step', () => {
    openConversation({ entries: [{ id: 'x1', at: AT, type: 'tool', role: 'CEO', title: 'One', status: 'completed' }] });
    expect(screen.getByRole('button', { name: /Show details.*\(1 step\)/ })).toBeInTheDocument();
  });

  it('renders agent responses with the footer, failures and cancellations', () => {
    const agentInfo = { roleName: 'Tech Lead', agentName: 'Codex', modelName: 'gpt', effortName: 'high' };
    openConversation({
      entries: [
        { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: '**bold** text', agentInfo },
        { id: 'r2', at: AT, type: 'agent_response', status: 'failed', response: '', errorMessage: 'it broke' },
        { id: 'r3', at: AT, type: 'agent_response', status: 'failed', response: '' },
        { id: 'r4', at: AT, type: 'agent_response', status: 'cancelled', response: 'partial' },
      ],
    });
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('Tech Lead · Codex · gpt · high')).toBeInTheDocument();
    expect(screen.getByText('it broke')).toBeInTheDocument();
    expect(screen.getByText('The agent failed.')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders each delegation as one handoff card and shows notices', async () => {
    const user = userEvent.setup();
    openConversation({
      entries: [
        { id: 'd1', at: AT, type: 'delegation', delegationId: '1:TECH_LEAD', phase: 'started', round: 1, role: 'TECH_LEAD', roleName: 'Tech Lead Agent', summary: 'Planning the login', projectName: 'app' },
        { id: 'd2', at: AT, type: 'delegation', delegationId: '1:TECH_LEAD', phase: 'finished', round: 1, role: 'TECH_LEAD', roleName: 'Tech Lead Agent', summary: 'Planning the login', response: 'all done', durationMs: 550_000 },
        { id: 'd3', at: AT, type: 'delegation', delegationId: '2:DEVELOPER', phase: 'started', round: 2, role: 'DEVELOPER', roleName: 'Developer Agent', summary: 'Building the login' },
        { id: 'd4', at: AT, type: 'delegation', delegationId: '2:DEVELOPER', phase: 'failed', round: 2, role: 'DEVELOPER', roleName: 'Developer Agent', summary: 'Building the login', errorMessage: 'compiler exploded', durationMs: 4000 },
        { id: 'n1', at: AT, type: 'notice', level: 'info', text: 'fyi' },
        { id: 'n2', at: AT, type: 'notice', level: 'warning', text: 'careful' },
        { id: 'n3', at: AT, type: 'notice', level: 'error', text: 'bad' },
      ],
    });
    const feed = within(screen.getByTestId('message-viewport'));
    expect(feed.getByText(/Planning the login/)).toBeInTheDocument();
    expect(feed.getByText('9m 10s')).toBeInTheDocument();
    expect(feed.getByText('Failed · 4 s')).toBeInTheDocument();
    expect(feed.queryByText('all done')).not.toBeInTheDocument();
    await user.click(feed.getByRole('button', { name: 'See the result' }));
    expect(feed.getByText('all done')).toBeInTheDocument();
    expect(feed.queryByText('compiler exploded')).not.toBeInTheDocument();
    await user.click(feed.getByRole('button', { name: 'See what went wrong' }));
    expect(feed.getByText('compiler exploded')).toBeInTheDocument();
    expect(screen.getByText('fyi')).toBeInTheDocument();
    expect(screen.getByText('careful')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('shows what a working agent does in its delegation row and keeps its steps inside', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({
      entries: [
        userEntry('u1'),
        { id: 'a1', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer Agent', summary: 'Building the API' },
        { id: 't1', at: AT, type: 'tool', role: 'DEVELOPER', title: 'Read file', status: 'completed' },
        { id: 't2', at: AT, type: 'thought', role: 'DEVELOPER', text: 'Looking at the router' },
      ],
    });
    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

    const feed = within(screen.getByTestId('message-viewport'));
    expect(within(screen.getByRole('region', { name: 'Your squad' })).getByText('Thinking')).toBeInTheDocument();
    expect(feed.queryByText('Looking at the router')).not.toBeInTheDocument();
    await user.click(feed.getByRole('button', { name: 'See the steps' }));
    expect(feed.getByText('Looking at the router')).toBeInTheDocument();
  });

  it('shows a delegation that started without steps as working', () => {
    const { connection } = openConversation({
      entries: [
        userEntry('u1'),
        { id: 'a1', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer Agent', summary: 'Building the API' },
      ],
    });
    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

    expect(within(screen.getByRole('region', { name: 'Your squad' })).getByText('Starting')).toBeInTheDocument();
    expect(within(screen.getByTestId('message-viewport')).getByRole('region', { name: 'Delegation' }).firstElementChild).toHaveAttribute('data-status', 'working');
  });

  it('introduces the team in an empty conversation and offers a request to start from', async () => {
    const user = userEvent.setup();
    openConversation();

    expect(screen.getByRole('heading', { name: 'Meet your team' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Fix the failing tests/ }));

    const field = screen.getByLabelText('Message');
    expect(field).toHaveValue('Fix the failing tests');
    expect(field).toHaveFocus();
  });

  it('lists agents that worked together one line each and stops the clock when the turn ends', () => {
    openConversation({
      entries: [
        userEntry('u1'),
        { id: 'a1', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer Agent', summary: 'Building the API' },
        { id: 'a2', at: AT, type: 'delegation', delegationId: '1:CODE_REVIEWER', phase: 'started', round: 1, role: 'CODE_REVIEWER', roleName: 'Reviewer', summary: 'Reviewing the docs' },
        { id: 'a3', at: AT, type: 'delegation', delegationId: '1:CODE_REVIEWER', phase: 'finished', round: 1, role: 'CODE_REVIEWER', roleName: 'Reviewer', summary: 'Reviewing the docs', durationMs: 1000 },
        { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'All done' },
      ],
    });

    const feed = within(screen.getByTestId('message-viewport'));
    expect(feed.getByRole('region', { name: 'Delegation' }).children).toHaveLength(2);
    expect(feed.getByText('Stopped')).toBeInTheDocument();
    expect(feed.getByText(/2 agents/)).toBeInTheDocument();
  });

  it('sends structured answers and keeps only the open question active', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({
      entries: [
        { id: 'q1', at: AT, type: 'question', askerRole: 'CEO', askerRoleName: 'CEO', text: 'Old question', options: ['A'], number: 1, total: 1, closed: true },
        { id: 'q2', at: AT, type: 'question', askerRole: 'TECH_LEAD', askerRoleName: 'Tech Lead', text: 'Pick one', rationale: 'because', options: ['Yes', 'No'], number: 2, total: 3, closed: false },
      ],
    });
    expect(document.body).toHaveTextContent('Question 2 of 3');
    expect(screen.getByText('because')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument();
    expect(screen.getByText('Old question')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(connection.sent).toContainEqual({
      type: 'question.answer', conversationId: 'c1', answer: { kind: 'option', optionIndex: 2 },
    });

    const activeInput = screen.getByLabelText('Your answer');
    await user.type(activeInput, ' free text {Enter}');
    expect(connection.sent).toContainEqual({
      type: 'question.answer', conversationId: 'c1', answer: { kind: 'text', text: 'free text' },
    });
    expect(activeInput).toHaveValue('');
  });

  it('renders a question the server closed in its closed form', () => {
    openConversation({
      entries: [
        { id: 'q1', at: AT, type: 'question', askerRole: 'CEO', askerRoleName: 'CEO', text: 'Open?', options: ['A'], number: 1, total: 1, closed: true },
        { id: 'n1', at: AT, type: 'notice', level: 'info', text: 'Answers sent to CEO.' },
      ],
    });
    expect(screen.getByText('Open?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
  });

  it('shows the context the agent wrote, its project and why the answer matters', () => {
    openConversation({
      entries: [
        {
          id: 'q1', at: AT, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', projectName: 'api', message: 'Found two auth flows',
          text: 'Which one?', rationale: 'It changes the login route', options: ['A'], number: 1, total: 1, closed: false,
        },
      ],
    });
    expect(screen.getByText('Found two auth flows')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('Developer · api asks');
    expect(document.body).toHaveTextContent('Why it matters: It changes the login route');
  });

  it('renders a question without options', () => {
    openConversation({
      entries: [{ id: 'q1', at: AT, type: 'question', askerRole: 'CEO', askerRoleName: 'CEO', text: 'Open?', options: [], number: 1, total: 1, closed: false }],
    });
    expect(screen.queryByText(/Question 1 of/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeEnabled();
  });

  describe('composer', () => {
    it('sends on Enter and keeps a newline on Shift+Enter', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      const box = screen.getByLabelText('Message');

      await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
      expect(box).toHaveValue('line one\nline two');
      await user.keyboard('{Enter}');

      expect(connection.sent).toContainEqual({ type: 'message.send', conversationId: 'c1', text: 'line one\nline two' });
      expect(box).toHaveValue('');
    });

    it('does not send blank text or while composing', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      const box = screen.getByLabelText('Message');

      await user.type(box, '   {Enter}');
      fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
      expect(connection.sent.some(command => command.type === 'message.send')).toBe(false);
    });

    it('sends with the button', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      await user.type(screen.getByLabelText('Message'), 'go');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(connection.sent).toContainEqual({ type: 'message.send', conversationId: 'c1', text: 'go' });
    });

    it('is disabled while the connection is not open', () => {
      const { connection } = openConversation();
      act(() => connection.emitStatus('closed'));
      expect(screen.getByLabelText('Message')).toBeDisabled();
    });

    it('is disabled while the conversation is not configured and opens the settings sheet', () => {
      openConversation({ configured: false });
      expect(screen.getByLabelText('Message')).toBeDisabled();
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    });

    it('shows Stop while running or queued, keeps the composer enabled and cancels the turn', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

      act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'queued' }));
      expect(screen.getByLabelText('Message')).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Stop' }));
      expect(connection.sent).toContainEqual({ type: 'turn.cancel', conversationId: 'c1' });
    });
  });

  describe('draft', () => {
    const emitDraft = (connection: ReturnType<typeof openConversation>['connection'], text: string) =>
      act(() => connection.emitEvent({ type: 'conversation.draft', conversationId: 'c1', text }));

    it('shows the response as it is written, then gives way to the one that is delivered', () => {
      const { connection } = openConversation({ entries: [userEntry('u1', 'question')] });
      act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

      emitDraft(connection, 'The answer is');
      emitDraft(connection, 'The answer is **42**');
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getAllByText(/The answer is/)).toHaveLength(1);

      emitDraft(connection, '');
      act(() => connection.emitEvent({
        type: 'conversation.entry',
        conversationId: 'c1',
        entry: { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'The answer is 42.' },
      }));
      expect(screen.getAllByText(/The answer is/)).toHaveLength(1);
      expect(screen.getByText('The answer is 42.')).toBeInTheDocument();
    });

    it('shows the draft a reopened conversation was in the middle of', () => {
      const { connection } = renderApp('/c/c1');
      act(() => connection.emitEvent({
        type: 'conversation.history', conversationId: 'c1', entries: [], state: 'running', draft: 'Half way',
      }));

      expect(screen.getByText('Half way')).toBeInTheDocument();
    });

    it('stops calling the steps "Working…" once the response is being written', () => {
      const { connection } = openConversation({ entries: [{ id: 'x1', at: AT, type: 'tool', role: 'CEO', title: 'Read', status: 'completed' }] });
      act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));
      expect(screen.getByRole('button', { name: /Reading files….*\(1 step\)/ })).toBeInTheDocument();

      emitDraft(connection, 'Writing');

      expect(screen.getByRole('button', { name: /Show details.*\(1 step\)/ })).toBeInTheDocument();
    });

    it('shows the agents at work as soon as the turn runs, before any step', () => {
      const { connection } = openConversation({ entries: [{ id: 'u1', at: AT, type: 'user_message', text: 'Hi' }] });
      expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument();

      act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));
      expect(screen.getByRole('status')).toHaveTextContent('Coordinator is thinking…');

      emitDraft(connection, 'Writing');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not show the agents at work while a question waits for the user', () => {
      const { connection } = openConversation({
        entries: [{ id: 'q1', at: AT, type: 'question', askerRole: 'CEO', askerRoleName: 'CEO', text: 'Which?', options: ['A'], number: 1, total: 1, closed: false }],
      });

      act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('prompt history', () => {
    it('recalls a previous prompt with ArrowUp and clears the navigation after sending', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      const field = screen.getByLabelText('Message');

      await user.click(field);
      await user.keyboard('{ArrowUp}');
      const request = connection.sent.find(command => command.type === 'prompts.history');
      await act(async () => connection.emitEvent({ type: 'prompts.list', requestId: request?.type === 'prompts.history' ? request.requestId : '', prompts: ['again please'] }));

      expect(field).toHaveValue('again please');
      expect(screen.getByText('History 1/1')).toBeInTheDocument();

      await user.keyboard('{Enter}');

      expect(connection.sent).toContainEqual({ type: 'message.send', conversationId: 'c1', text: 'again please' });
      expect(field).toHaveValue('');
      expect(screen.queryByText('History 1/1')).not.toBeInTheDocument();
    });
  });

  describe('file mentions', () => {
    it('inserts the chosen path with Enter instead of sending the message', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      const field = screen.getByLabelText('Message');

      await user.click(field);
      await user.keyboard('read @');
      const search = connection.sent.findLast(command => command.type === 'files.search');
      await act(async () => connection.emitEvent({
        type: 'files.results',
        requestId: search?.type === 'files.search' ? search.requestId : '',
        items: [{ path: 'app/main.ts', kind: 'file', matches: [0] }],
        walking: false,
      }));

      expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
      await user.keyboard('{Enter}');

      expect(field).toHaveValue('read @app/main.ts ');
      expect(connection.sent.some(command => command.type === 'message.send')).toBe(false);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('attachments', () => {
    const stored = { path: '.arc-uploads/c1/shot.png', name: 'shot.png' };

    /** Plays the server's side of one upload of a small file. */
    async function completeUpload(connection: ReturnType<typeof openConversation>['connection']) {
      const start = await vi.waitFor(() => {
        const command = connection.sent.find(sent => sent.type === 'upload.start');
        expect(command).toBeDefined();
        return command as Extract<typeof connection.sent[number], { type: 'upload.start' }>;
      });
      act(() => connection.emitEvent({ type: 'upload.ready', uploadId: start.uploadId }));
      await waitFor(() => expect(connection.sent.some(sent => sent.type === 'upload.chunk')).toBe(true));
      act(() => connection.emitEvent({ type: 'upload.ack', uploadId: start.uploadId, index: 0 }));
      await waitFor(() => expect(connection.sent.some(sent => sent.type === 'upload.finish')).toBe(true));
      act(() => connection.emitEvent({ type: 'upload.done', uploadId: start.uploadId, attachment: stored }));
    }

    const attach = (file: File) => fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } });

    it('uploads a picked file and sends it with the message, with or without text', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();

      attach(new File(['png'], 'shot.png'));
      expect(await screen.findByLabelText('Uploading')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

      await completeUpload(connection);
      expect(await screen.findByRole('button', { name: 'Remove shot.png' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(connection.sent).toContainEqual({ type: 'message.send', conversationId: 'c1', text: '', attachments: [stored] });
      expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
    });

    describe('voice recording', () => {
      class RecorderStub {
        static isTypeSupported = () => true;
        state = 'inactive';
        mimeType = 'audio/webm';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = 'recording';
        }

        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['voice']) });
          this.onstop?.();
        }
      }

      let media: FakeMediaDevices;

      beforeEach(() => {
        vi.stubGlobal('MediaRecorder', RecorderStub);
        media = new FakeMediaDevices();
        media.devices = [audioInput('a', 'Headset'), audioInput('b', 'Desk mic')];
        media.install();
        localStorage.clear();
      });

      afterEach(() => {
        Reflect.deleteProperty(globalThis, 'MediaRecorder');
        FakeMediaDevices.uninstall();
      });

      it('attaches the recording to the message without sending it', async () => {
        const user = userEvent.setup();
        const { connection } = openConversation();

        await user.click(screen.getByRole('button', { name: 'Record audio' }));
        expect(await screen.findByRole('status', { name: 'Recording' })).toHaveTextContent('0:00');
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Attach recording' }));
        await completeUpload(connection);

        expect(await screen.findByRole('button', { name: /^Remove recording-.*\.webm$/ })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
        expect(connection.sent.some(sent => sent.type === 'message.send')).toBe(false);
      });

      it('discards the recording', async () => {
        const user = userEvent.setup();
        const { connection } = openConversation();

        await user.click(screen.getByRole('button', { name: 'Record audio' }));
        await user.click(await screen.findByRole('button', { name: 'Discard recording' }));

        expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
        expect(connection.sent.some(sent => sent.type === 'upload.start')).toBe(false);
      });

      it('lists the microphones with the selected one marked and records with the chosen one', async () => {
        const user = userEvent.setup();
        openConversation();

        await user.click(screen.getByRole('button', { name: 'Choose microphone' }));
        expect(await screen.findByRole('menuitemradio', { name: 'System default' })).toBeChecked();
        await user.click(await screen.findByRole('menuitemradio', { name: 'Desk mic' }));
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Choose microphone' }));
        expect(await screen.findByRole('menuitemradio', { name: 'Desk mic' })).toBeChecked();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Record audio' }));
        await screen.findByRole('status', { name: 'Recording' });
        expect(media.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'b' } } });
      });

      it('shows why the recording could not start', async () => {
        const user = userEvent.setup();
        media.getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
        openConversation();

        await user.click(screen.getByRole('button', { name: 'Record audio' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was denied');
      });
    });

    it('opens the file picker from the attach button', async () => {
      const user = userEvent.setup();
      openConversation();
      const click = vi.spyOn(screen.getByLabelText('Attach files'), 'click');

      await user.click(screen.getByRole('button', { name: 'Attach' }));

      expect(click).toHaveBeenCalledOnce();
    });

    it('attaches dropped files and shows the drop hint while dragging', () => {
      const { connection } = openConversation();
      const zone = screen.getByLabelText('Message').closest('div[class*="flex-col"]') as HTMLElement;

      fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
      expect(screen.getByText('Drop files to attach them')).toBeInTheDocument();
      fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'dropped.txt')] } });

      expect(screen.queryByText('Drop files to attach them')).not.toBeInTheDocument();
      expect(connection.sent).toContainEqual(expect.objectContaining({ type: 'upload.start', name: 'dropped.txt' }));
    });

    it('does not accept drops while the composer is disabled', () => {
      const { connection } = openConversation({ configured: false });
      const zone = screen.getByLabelText('Message').closest('div[class*="flex-col"]') as HTMLElement;

      fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'dropped.txt')] } });

      expect(connection.sent.some(sent => sent.type === 'upload.start')).toBe(false);
    });

    it('attaches an image pasted into the field', () => {
      const { connection } = openConversation();

      fireEvent.paste(screen.getByLabelText('Message'), { clipboardData: { files: [new File(['x'], 'image.png')] } });

      expect(connection.sent).toContainEqual(expect.objectContaining({ type: 'upload.start', name: 'image.png' }));
    });

    it('lets a failed file be removed and keeps sending blocked only while uploading', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation();
      attach(new File(['x'], 'broken.bin'));
      const start = await vi.waitFor(() => connection.sent.find(sent => sent.type === 'upload.start') as { uploadId: string });

      act(() => connection.emitEvent({ type: 'upload.failed', uploadId: start.uploadId, reason: 'File is too large' }));
      await user.click(await screen.findByRole('button', { name: 'Remove broken.bin' }));

      expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
    });

    it('shows the attachments of a user message as read-only chips', () => {
      openConversation({
        entries: [{ id: 'u1', at: AT, type: 'user_message', text: 'look', attachments: [stored] }],
      });

      const chips = screen.getByRole('list', { name: 'Attachments' });
      expect(within(chips).getByText('shot.png')).toBeInTheDocument();
      expect(within(chips).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByText('look')).toBeInTheDocument();
    });

    it('shows a user message that has only attachments without an empty text block', () => {
      openConversation({
        entries: [{ id: 'u1', at: AT, type: 'user_message', text: '', attachments: [stored] }],
      });

      expect(screen.getByText('shot.png')).toBeInTheDocument();
      expect(document.querySelector('p.whitespace-pre-wrap')).toBeNull();
    });
  });
});
