import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AT, renderApp } from '../test/render-app.js';


describe('AppLayout', () => {
  it('should ask for the token when none is stored', async () => {
    const { connection } = renderApp();
    act(() => connection.emitStatus('unauthorized'));
    expect(screen.getByLabelText('Access token')).toBeInTheDocument();
  });

  it.each([
    ['connecting', 'Connecting'],
    ['open', 'Connected'],
    ['closed', 'Disconnected'],
  ] as const)('should show the %s status in the badge', (status, label) => {
    const { connection } = renderApp();
    act(() => connection.emitStatus(status));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('should request the conversation list when the connection opens', () => {
    const { connection } = renderApp();
    expect(connection.sent).toContainEqual({ type: 'conversation.list' });
  });

  it('should create a conversation from the header outside the home screen', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp('/skills');

    await user.click(screen.getByRole('button', { name: 'New conversation' }));
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

  it('should focus the home composer from the header instead of creating a conversation at /', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp();
    expect(screen.getByLabelText('Message')).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(screen.getByLabelText('Message')).toHaveFocus();
    expect(connection.sent.some(command => command.type === 'conversation.create')).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('should not navigate for conversations created by another request', () => {
    const { connection, router } = renderApp();
    act(() => connection.emitEvent({
      type: 'conversation.created',
      requestId: 'someone-else',
      conversation: { id: 'x', title: 'X', createdAt: AT, updatedAt: AT },
    }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('should list conversations with a spinner while running or queued', async () => {
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

  it('should show when each conversation last changed and keep the label current', async () => {
    // Only the clock of the label: the dialog and user-event keep their real timers.
    rs.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      const user = userEvent.setup();
      rs.setSystemTime(new Date(AT));
      const { connection } = renderApp();
      act(() => connection.emitEvent({
        type: 'conversation.list',
        conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
      }));
      await user.click(screen.getByRole('button', { name: 'Show conversations' }));
      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText('just now')).toBeInTheDocument();

      act(() => rs.advanceTimersByTime(5 * 60_000));

      expect(dialog.getByText('5 minutes ago')).toBeInTheDocument();
    } finally {
      rs.useRealTimers();
    }
  });

  it('should keep the drawer closed on narrow screens until the toggle opens it', async () => {
    const user = userEvent.setup();
    renderApp();
    const toggle = screen.getByRole('button', { name: 'Show conversations' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Conversations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(screen.getByRole('dialog')).getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
  });

  it('should close the drawer after picking a conversation', async () => {
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
    const wide = (query: string) => ({ matches: query === '(min-width: 768px)', addEventListener: rs.fn(), removeEventListener: rs.fn() });
    const defaultMatchMedia = globalThis.matchMedia;
    const dock = () => document.getElementById('conversation-list')!;

    beforeEach(() => {
      rs.stubGlobal('matchMedia', wide);
    });
    afterEach(() => {
      rs.stubGlobal('matchMedia', defaultMatchMedia);
      rs.restoreAllMocks();
    });

    it('should dock the list beside the page, closed by default, and toggle it with no drawer', async () => {
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

    it('should open the docked list from See all', async () => {
      const user = userEvent.setup();
      const { connection } = renderApp();
      act(() => connection.emitEvent({
        type: 'conversation.list',
        conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
      }));
      expect(dock()).not.toBeVisible();

      await user.click(screen.getByRole('button', { name: 'See all' }));

      expect(dock()).toBeVisible();
    });

    it('should not offer See all while the docked list is open', async () => {
      const user = userEvent.setup();
      const { connection } = renderApp();
      act(() => connection.emitEvent({
        type: 'conversation.list',
        conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
      }));
      expect(screen.getByRole('button', { name: 'See all' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show conversations' }));
      expect(screen.queryByRole('button', { name: 'See all' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Hide conversations' }));
      expect(screen.getByRole('button', { name: 'See all' })).toBeInTheDocument();
    });

    it('should stay open after picking a conversation', async () => {
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

    it('should remember the choice and render when storage throws', async () => {
      const user = userEvent.setup();
      renderApp();
      await user.click(screen.getByRole('button', { name: 'Show conversations' }));
      expect(localStorage.getItem('arc.conversationListOpen')).toBe('true');
      cleanup();

      const read = Storage.prototype.getItem;
      rs.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'arc.conversationListOpen') {
          return 'true';
        }
        return read.call(this, key);
      });
      renderApp();
      expect(dock()).toBeVisible();
      cleanup();

      rs.restoreAllMocks();
      rs.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'arc.conversationListOpen') {
          throw new Error('blocked');
        }
        return read.call(this, key);
      });
      renderApp();
      expect(dock()).not.toBeVisible();
    });
  });

  it('should open the drawer from See all on the home screen', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp();
    act(() => connection.emitEvent({
      type: 'conversation.list',
      conversations: [{ id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT }],
    }));

    await user.click(screen.getByRole('button', { name: 'See all' }));

    expect(within(screen.getByRole('dialog')).getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
  });

  it('should put New conversation in the header, before the title, and not in the drawer', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp('/skills');
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
  describe('below sm', () => {
    it('should keep the indicators in the header and the secondary links and the theme in the More menu', () => {
      renderApp();
      const header = screen.getByRole('banner');

      expect(within(header).getByRole('button', { name: 'More' })).toHaveClass('sm:hidden');
      for (const link of ['Skills', 'Settings']) {
        expect(within(header).getByRole('link', { name: link })).toHaveClass('hidden', 'sm:inline-flex');
      }
      expect(within(header).getByRole('button', { name: 'Theme' })).toHaveClass('hidden', 'sm:inline-flex');
      expect(within(header).getByRole('button', { name: /Agent logins/ })).not.toHaveClass('hidden');
      expect(within(header).getByRole('button', { name: /usage/i })).not.toHaveClass('hidden');
      expect(within(header).getByRole('button', { name: /over/ })).not.toHaveClass('hidden');
    });

    it.each([
      ['Skills', '/skills'],
      ['Settings', '/settings'],
    ])('should open %s from the More menu, remembering the page it left', async (name, path) => {
      const user = userEvent.setup();
      const { router } = renderApp('/c/c1');

      await user.click(screen.getByRole('button', { name: 'More' }));
      await user.click(await screen.findByRole('menuitem', { name }));

      expect(router.state.location.pathname).toBe(path);
      expect(router.state.location.state).toEqual({ returnTo: '/c/c1' });
    });

    it('should change the theme from the More menu', async () => {
      const user = userEvent.setup();
      renderApp();

      await user.click(screen.getByRole('button', { name: 'More' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

      expect(document.documentElement).toHaveClass('dark');
      expect(localStorage.getItem('arc.theme')).toBe('dark');
    });
  });
});
