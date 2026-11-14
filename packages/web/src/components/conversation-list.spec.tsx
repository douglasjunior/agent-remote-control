import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AT, openConversation, renderApp } from '../test/render-app.js';


const alpha = { id: 'a', title: 'Alpha', createdAt: AT, updatedAt: AT };
const beta = { id: 'b', title: 'Beta', createdAt: AT, updatedAt: AT, archivedAt: AT };

async function openList() {
  const user = userEvent.setup();
  const app = renderApp();
  act(() => app.connection.emitEvent({ type: 'conversation.list', conversations: [alpha, beta] }));
  await user.click(screen.getByRole('button', { name: 'Show conversations' }));
  return { user, app, list: screen.getByRole('navigation', { name: 'Conversations' }) };
}

async function chooseAction(user: ReturnType<typeof userEvent.setup>, title: string, action: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${title}` }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

describe('ConversationList', () => {
  it('keeps archived conversations in a collapsed group at the bottom, remembered per viewer', async () => {
    const { user, list } = await openList();
    expect(within(list).getByRole('link', { name: /Alpha/ })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: /Beta/ })).not.toBeInTheDocument();
    const toggle = within(list).getByRole('button', { name: 'Archived (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('arc.archivedConversationsOpen')).toBe('true');
    expect(within(screen.getByRole('list', { name: 'Archived conversations' })).getByRole('link', { name: /Beta/ })).toHaveAttribute('href', '/c/b');
  });

  it('archives and unarchives from the row menu, following the server', async () => {
    const { user, app, list } = await openList();
    await chooseAction(user, 'Alpha', 'Archive');
    expect(app.connection.sent.at(-1)).toEqual({ type: 'conversation.archive', conversationId: 'a', archived: true });
    act(() => app.connection.emitEvent({ type: 'conversation.updated', conversation: { ...alpha, archivedAt: AT } }));
    expect(within(list).getByRole('button', { name: 'Archived (2)' })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: /Alpha/ })).not.toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: 'Archived (2)' }));
    await chooseAction(user, 'Beta', 'Unarchive');
    expect(app.connection.sent.at(-1)).toEqual({ type: 'conversation.archive', conversationId: 'b', archived: false });
  });

  it('renames a conversation in place: Enter or leaving saves, Escape and blank or unchanged titles do not', async () => {
    const { user, app } = await openList();
    const renames = () => app.connection.sent.filter(command => command.type === 'conversation.rename');

    await chooseAction(user, 'Alpha', 'Rename');
    let input = screen.getByRole('textbox', { name: 'Conversation title' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, '  Release plan  {Enter}');
    expect(renames()).toEqual([{ type: 'conversation.rename', conversationId: 'a', title: 'Release plan' }]);
    expect(screen.queryByRole('textbox', { name: 'Conversation title' })).not.toBeInTheDocument();

    await chooseAction(user, 'Alpha', 'Rename');
    input = screen.getByRole('textbox', { name: 'Conversation title' });
    await user.type(input, ' draft{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Conversation title' })).not.toBeInTheDocument();

    await chooseAction(user, 'Alpha', 'Rename');
    input = screen.getByRole('textbox', { name: 'Conversation title' });
    await user.clear(input);
    fireEvent.blur(input);
    await chooseAction(user, 'Alpha', 'Rename');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation title' }), { key: 'a' });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Conversation title' }));

    await chooseAction(user, 'Alpha', 'Rename');
    input = screen.getByRole('textbox', { name: 'Conversation title' });
    await user.type(input, ' notes');
    fireEvent.blur(input);
    expect(renames()).toEqual([
      { type: 'conversation.rename', conversationId: 'a', title: 'Release plan' },
      { type: 'conversation.rename', conversationId: 'a', title: 'Alpha notes' },
    ]);
  });

  it('renames the open conversation from its header', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation();
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }));
    const input = screen.getByRole('textbox', { name: 'Conversation title' });
    await user.clear(input);
    await user.type(input, 'Checkout{Enter}');
    expect(connection.sent.at(-1)).toEqual({ type: 'conversation.rename', conversationId: 'c1', title: 'Checkout' });
    expect(screen.getByRole('heading', { name: 'My task' })).toBeInTheDocument();
  });
});
