import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { openConversation, userEntry } from '../test/render-app.js';


const earlierRequests = (sent: readonly { type: string }[]) => sent.filter(command => command.type === 'conversation.entries');

describe('ConversationView earlier entries', () => {
  it('should ask for the entries before the latest page until the history has none left', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({ entries: [userEntry('u3', 'latest')], start: 2 });

    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    expect(connection.sent).toContainEqual({ type: 'conversation.entries', conversationId: 'c1', before: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('Loading earlier messages…');

    act(() => connection.emitEvent({ type: 'conversation.entries', conversationId: 'c1', start: 0, entries: [userEntry('u1', 'first'), userEntry('u2', 'second')] }));

    expect(screen.getByText('latest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should offer nothing earlier when the history starts with the entries shown', () => {
    openConversation({ entries: [userEntry('u1')] });

    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();
  });

  it('should ask once for a position, and again once a lost connection is back', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({ entries: [userEntry('u3')], start: 2 });
    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();

    act(() => connection.emitStatus('closed'));
    act(() => connection.emitStatus('open'));
    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    expect(earlierRequests(connection.sent)).toHaveLength(2);
  });
});
