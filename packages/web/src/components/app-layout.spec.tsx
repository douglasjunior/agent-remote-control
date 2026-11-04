import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AT, renderApp } from '../test/render-app.js';


describe('AppLayout', () => {
  it('asks for the token when none is stored', async () => {
    const { connection } = renderApp();
    act(() => connection.emitStatus('unauthorized'));
    expect(screen.getByLabelText('Access token')).toBeInTheDocument();
  });

  it.each([
    ['connecting', 'Connecting'],
    ['open', 'Connected'],
    ['closed', 'Disconnected'],
  ] as const)('shows the %s status in the badge', (status, label) => {
    const { connection } = renderApp();
    act(() => connection.emitStatus(status));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('requests the conversation list when the connection opens', () => {
    const { connection } = renderApp();
    expect(connection.sent).toContainEqual({ type: 'conversation.list' });
  });

  it('shows the empty state at / and creates a conversation from it', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp();
    const [, emptyAction] = screen.getAllByRole('button', { name: /New conversation/ });

    await user.click(emptyAction);
    const create = connection.sent.find(command => command.type === 'conversation.create');
    expect(create).toBeDefined();

    act(() => connection.emitEvent({
      type: 'conversation.created',
      requestId: (create as { requestId: string }).requestId,
      conversation: { id: 'new', title: 'New', createdAt: AT, updatedAt: AT },
    }));
    expect(router.state.location.pathname).toBe('/c/new');
    expect(connection.sent).toContainEqual({ type: 'conversation.history', conversationId: 'new' });
    expect(connection.sent).toContainEqual({ type: 'profiles.get', conversationId: 'new' });
  });

  it('does not navigate for conversations created by another request', () => {
    const { connection, router } = renderApp();
    act(() => connection.emitEvent({
      type: 'conversation.created',
      requestId: 'someone-else',
      conversation: { id: 'x', title: 'X', createdAt: AT, updatedAt: AT },
    }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('lists conversations with a spinner while running or queued', () => {
    const { connection } = renderApp();
    act(() => {
      connection.emitEvent({
        type: 'conversation.list',
        conversations: [
          { id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT },
          { id: 'b', title: 'Beta', createdAt: AT, updatedAt: AT },
        ],
      });
      connection.emitEvent({ type: 'conversation.state', conversationId: 'a', state: 'running' });
    });

    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Running')).toHaveLength(1);
  });

  it('opens the sidebar as a sheet on narrow screens and closes it after navigating', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp();
    act(() => connection.emitEvent({
      type: 'conversation.list',
      conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
    }));

    await user.click(screen.getByRole('button', { name: 'Open conversations' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('Alpha'));

    expect(router.state.location.pathname).toBe('/c/a');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a conversation from the sheet and closes it', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Open conversations' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /New conversation/ }));

    expect(connection.sent.some(command => command.type === 'conversation.create')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
