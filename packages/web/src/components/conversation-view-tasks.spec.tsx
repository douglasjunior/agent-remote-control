import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { summary } from '../test/artifact-fixtures.js';
import { AT, openConversation } from '../test/render-app.js';


describe('ConversationView and the mission board', () => {
  it('asks for the board with the conversation and counts its open tasks', () => {
    const { connection } = openConversation();
    expect(connection.sent).toContainEqual({ type: 'artifacts.list', conversationId: 'c1' });
    act(() => connection.emitEvent({
      type: 'artifacts.list',
      conversationId: 'c1',
      artifacts: [
        summary({ id: 'F-1', type: 'feature' }),
        summary({ id: 'T-1' }),
        summary({ id: 'T-2', status: 'in_review' }),
        summary({ id: 'T-3', status: 'done' }),
      ],
    }));
    expect(screen.getByLabelText('2 open')).toBeInTheDocument();
  });

  it('switches between the chat and the board, keeping the chat in place', async () => {
    const user = userEvent.setup();
    const { router } = openConversation();
    const conversation = screen.getByRole('navigation', { name: 'Conversation' });
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    expect(conversation).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /Tasks/ }));
    expect(router.state.location.pathname).toBe('/c/c1/tasks');
    expect(screen.getByRole('link', { name: /Tasks/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Mission board' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message', hidden: true })).not.toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Chat' }));
    expect(router.state.location.pathname).toBe('/c/c1');
    expect(screen.queryByRole('heading', { name: 'Mission board' })).not.toBeInTheDocument();
  });

  it('links a delegation to the task its agent holds', () => {
    openConversation({
      entries: [
        { id: 'u1', at: AT, type: 'user_message', text: 'Build it' },
        {
          id: 'd1',
          at: AT,
          type: 'delegation',
          delegationId: 'dl-1',
          phase: 'started',
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Developer',
          summary: 'Building the login API',
          prompt: 'Implement it',
          artifactId: 'T-2',
        },
      ],
    });
    expect(screen.getByRole('link', { name: 'T-2' })).toHaveAttribute('href', '/c/c1/tasks/T-2');
  });
});
