import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { emitLogin, emitStatus, sentOfType } from '../../test/auth-fixtures.js';
import { renderApp } from '../../test/render-app.js';


function openAgents() {
  const app = renderApp('/settings/agents');
  act(() => app.connection.emitEvent({ type: 'settings', settings: [] }));
  return { ...app, user: userEvent.setup() };
}

describe('AgentLogins', () => {
  it('should say it is checking until the first answer, and list nothing for an empty one', async () => {
    const { connection } = openAgents();
    expect(screen.getByText('Checking the agents…')).toBeInTheDocument();

    emitStatus(connection);

    expect(await screen.findByText('No agent supports login here.')).toBeInTheDocument();
  });

  it('should list every agent with its state, account and button', () => {
    const { connection } = openAgents();
    emitStatus(connection, ['claude', 'authenticated', 'me@example.com'], ['codex', 'unauthenticated'], ['cursor', 'unknown']);

    const claude = screen.getByText('Claude Code').closest('li')!;
    expect(within(claude).getByText('Logged in')).toBeInTheDocument();
    expect(within(claude).getByText('me@example.com')).toBeInTheDocument();
    expect(within(claude).getByRole('button', { name: 'Re-authenticate Claude Code' })).toBeInTheDocument();
    const codex = screen.getAllByText('OpenAI Codex')[0]!.closest('li')!;
    expect(within(codex).getByText('Not logged in')).toBeInTheDocument();
    expect(within(codex).getByRole('button', { name: 'Authenticate OpenAI Codex' })).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('should start a login from its button and show the card with link, code and waiting state', async () => {
    const { connection, user } = openAgents();
    emitStatus(connection, ['claude', 'authenticated']);

    await user.click(screen.getByRole('button', { name: 'Re-authenticate Claude Code' }));
    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
    expect(screen.getByRole('button', { name: 'Re-authenticate Claude Code' })).toBeDisabled();
    expect(screen.getAllByText('Starting the login…').length).toBeGreaterThan(0);

    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'AB12-CD34' });
    const card = await screen.findByLabelText('Claude Code login');
    expect(within(card).getByRole('link', { name: /Open login page/ })).toHaveAttribute('href', 'https://claude.com/oauth');
    expect(within(card).getByText('AB12-CD34')).toBeInTheDocument();
    expect(within(card).getByText('Waiting for you to finish in the browser…')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(sentOfType(connection, 'auth.cancel')).toEqual([{ type: 'auth.cancel', agentId: 'claude' }]);
  });

  it('should copy the one-time code', async () => {
    const { connection, user } = openAgents();
    emitStatus(connection, ['claude', 'authenticated']);
    const writeText = rs.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Re-authenticate Claude Code' }));
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'AB12-CD34' });

    const card = await screen.findByLabelText('Claude Code login');
    await user.click(within(card).getByRole('button', { name: 'Copy code' }));

    expect(writeText).toHaveBeenCalledWith('AB12-CD34');
  });

  it('should show the reason a login failed and let the user start again', async () => {
    const { connection, user } = openAgents();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'failed', reason: 'Invalid code.' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code.');
    await user.click(screen.getByRole('button', { name: 'Authenticate Claude Code' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
  });
});
