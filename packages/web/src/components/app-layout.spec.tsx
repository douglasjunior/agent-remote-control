import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const [, emptyAction] = screen.getAllByRole('button', { name: 'New conversation' });

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

  it('lists conversations with a spinner while running or queued', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'Show conversations' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    expect(within(dialog).getAllByLabelText('Running')).toHaveLength(1);
  });

  it('keeps the drawer closed on narrow screens until the toggle opens it', async () => {
    const user = userEvent.setup();
    renderApp();
    const toggle = screen.getByRole('button', { name: 'Show conversations' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Conversations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(screen.getByRole('dialog')).getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
  });

  it('closes the drawer after picking a conversation', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp();
    act(() => connection.emitEvent({
      type: 'conversation.list',
      conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
    }));

    await user.click(screen.getByRole('button', { name: 'Show conversations' }));
    await user.click(within(screen.getByRole('dialog')).getByText('Alpha'));

    expect(router.state.location.pathname).toBe('/c/a');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('on wide screens', () => {
    const wide = (query: string) => ({ matches: query === '(min-width: 768px)', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const defaultMatchMedia = globalThis.matchMedia;
    const dock = () => document.getElementById('conversation-list')!;

    beforeEach(() => vi.stubGlobal('matchMedia', wide));
    afterEach(() => {
      vi.stubGlobal('matchMedia', defaultMatchMedia);
      vi.restoreAllMocks();
    });

    it('docks the list beside the page, closed by default, and toggles it with no drawer', async () => {
      const user = userEvent.setup();
      renderApp();
      const toggle = screen.getByRole('button', { name: 'Show conversations' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'conversation-list');
      expect(dock()).not.toBeVisible();

      await user.click(toggle);
      expect(screen.getByRole('button', { name: 'Hide conversations' })).toHaveAttribute('aria-expanded', 'true');
      expect(dock()).toBeVisible();
      expect(within(dock()).getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Hide conversations' }));
      expect(dock()).not.toBeVisible();
    });

    it('stays open after picking a conversation', async () => {
      const user = userEvent.setup();
      const { connection, router } = renderApp();
      act(() => connection.emitEvent({
        type: 'conversation.list',
        conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
      }));
      await user.click(screen.getByRole('button', { name: 'Show conversations' }));
      await user.click(within(dock()).getByText('Alpha'));

      expect(router.state.location.pathname).toBe('/c/a');
      expect(dock()).toBeVisible();
    });

    it('remembers the choice and renders when storage throws', async () => {
      const user = userEvent.setup();
      renderApp();
      await user.click(screen.getByRole('button', { name: 'Show conversations' }));
      expect(localStorage.getItem('arc.conversationListOpen')).toBe('true');
      cleanup();

      const read = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'arc.conversationListOpen') {
          return 'true';
        }
        return read.call(this, key);
      });
      renderApp();
      expect(dock()).toBeVisible();
      cleanup();

      vi.restoreAllMocks();
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'arc.conversationListOpen') {
          throw new Error('blocked');
        }
        return read.call(this, key);
      });
      renderApp();
      expect(dock()).not.toBeVisible();
    });
  });

  it('puts New conversation in the header, before the title, and not in the drawer', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp();
    const header = screen.getByRole('banner');
    const create = within(header).getByRole('button', { name: 'New conversation' });
    const title = within(header).getByRole('heading', { name: 'Agent Remote Control' });

    expect(within(header).getByRole('button', { name: 'Show conversations' }).compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title).toHaveClass('min-w-0', 'truncate');

    await user.click(create);
    expect(connection.sent.some(command => command.type === 'conversation.create')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Show conversations' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /New conversation/ })).not.toBeInTheDocument();
  });
});
