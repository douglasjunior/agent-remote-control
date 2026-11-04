import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AT, openConversation, userEntry } from '../test/render-app.js';


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
        { id: 't1', at: AT, type: 'thought', text: 'thinking hard' },
        { id: 't2', at: AT, type: 'thought', text: 'hidden', removed: true },
        { id: 'x1', at: AT, type: 'tool', title: 'Read file', status: 'completed' },
        { id: 'x2', at: AT, type: 'tool', title: 'Run tests', status: 'failed' },
        { id: 'x3', at: AT, type: 'tool', title: 'Lint', status: 'in_progress' },
      ],
    });
    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'running' }));

    const trigger = screen.getByRole('button', { name: 'Working… (4 steps)' });
    expect(screen.queryByText('Read file')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByText('Read file')).toBeInTheDocument();
    expect(screen.getByText('thinking hard')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(screen.getByLabelText('completed')).toBeInTheDocument();
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
    expect(screen.getByLabelText('running')).toBeInTheDocument();

    act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'idle' }));
    expect(screen.getByRole('button', { name: 'Show details (4 steps)' })).toBeInTheDocument();
  });

  it('uses the singular for a single step', () => {
    openConversation({ entries: [{ id: 'x1', at: AT, type: 'tool', title: 'One', status: 'completed' }] });
    expect(screen.getByRole('button', { name: 'Show details (1 step)' })).toBeInTheDocument();
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

  it('renders delegations and notices', async () => {
    const user = userEvent.setup();
    openConversation({
      entries: [
        { id: 'd1', at: AT, type: 'delegation', phase: 'started', round: 1, role: 'TECH_LEAD', roleName: 'Tech Lead', projectName: 'app' },
        { id: 'd2', at: AT, type: 'delegation', phase: 'finished', round: 1, role: 'TECH_LEAD', roleName: 'Tech Lead', response: 'all done', durationMs: 42_000 },
        { id: 'd3', at: AT, type: 'delegation', phase: 'finished', round: 2, role: 'DEVELOPER', roleName: 'Developer' },
        { id: 'n1', at: AT, type: 'notice', level: 'info', text: 'fyi' },
        { id: 'n2', at: AT, type: 'notice', level: 'warning', text: 'careful' },
        { id: 'n3', at: AT, type: 'notice', level: 'error', text: 'bad' },
      ],
    });
    expect(screen.getByText('Tech Lead started')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText('Tech Lead finished in 42 s')).toBeInTheDocument();
    expect(screen.getByText('Developer finished')).toBeInTheDocument();
    expect(screen.queryByText('all done')).not.toBeInTheDocument();
    await user.click(screen.getByText('Show response'));
    expect(screen.getByText('all done')).toBeInTheDocument();
    expect(screen.getByText('fyi')).toBeInTheDocument();
    expect(screen.getByText('careful')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('sends structured answers and keeps only the latest question active', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({
      entries: [
        { id: 'q1', at: AT, type: 'question', askerRoleName: 'CEO', text: 'Old question', options: ['A'], number: 1, total: 1 },
        { id: 'q2', at: AT, type: 'question', askerRoleName: 'Tech Lead', text: 'Pick one', rationale: 'because', options: ['Yes', 'No'], number: 2, total: 3 },
      ],
    });
    expect(document.body).toHaveTextContent('Question 2 of 3');
    expect(screen.getByText('because')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(connection.sent).toContainEqual({
      type: 'question.answer', conversationId: 'c1', answer: { kind: 'option', optionIndex: 2 },
    });

    const [, activeInput] = screen.getAllByLabelText('Your answer');
    await user.type(activeInput, ' free text {Enter}');
    expect(connection.sent).toContainEqual({
      type: 'question.answer', conversationId: 'c1', answer: { kind: 'text', text: 'free text' },
    });
    expect(activeInput).toHaveValue('');
  });

  it('renders a question without options', () => {
    openConversation({
      entries: [{ id: 'q1', at: AT, type: 'question', askerRoleName: 'CEO', text: 'Open?', options: [], number: 1, total: 1 }],
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

  describe('scrolling', () => {
    function viewport() {
      return screen.getByTestId('message-viewport');
    }

    function mockLayout(element: HTMLElement, scrollHeight: number, clientHeight: number) {
      Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
    }

    it('follows new entries unless the user scrolled up', () => {
      const { connection } = openConversation();
      const element = viewport();
      mockLayout(element, 1000, 400);
      const add = (id: string) => act(() => connection.emitEvent({
        type: 'conversation.entry', conversationId: 'c1', entry: userEntry(id),
      }));

      add('a');
      expect(element.scrollTop).toBe(1000);

      element.scrollTop = 100;
      fireEvent.scroll(element);
      mockLayout(element, 2000, 400);
      add('b');
      expect(element.scrollTop).toBe(100);

      element.scrollTop = 1590;
      fireEvent.scroll(element);
      add('c');
      expect(element.scrollTop).toBe(2000);
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
});
