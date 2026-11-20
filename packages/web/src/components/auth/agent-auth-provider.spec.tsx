import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { emitLogin, emitStatus, sentOfType } from '../../test/auth-fixtures.js';
import type { FakeServerConnection } from '../../test/fake-server-connection.js';
import { renderApp } from '../../test/render-app.js';


/** Opens the code input of the Agents section from the toast; the settings it lists arrive empty. */
async function enterCode(connection: FakeServerConnection, user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Enter code' }));
  act(() => connection.emitEvent({ type: 'settings', settings: [] }));
}

describe('AgentAuthProvider', () => {
  afterEach(() => {
    rs.useRealTimers();
    toast.dismiss();
  });

  it('should ask for the login state when the app connects', () => {
    const { connection } = renderApp();

    expect(sentOfType(connection, 'auth.status')).toEqual([{ type: 'auth.status' }]);
  });

  it('should show a persistent toast for an agent that is not logged in, once, and none for the others', async () => {
    const { connection } = renderApp();

    emitStatus(connection, ['claude', 'unauthenticated'], ['codex', 'authenticated'], ['cursor', 'unknown']);
    emitStatus(connection, ['claude', 'unauthenticated'], ['codex', 'authenticated'], ['cursor', 'unknown']);

    expect(await screen.findAllByText('Claude Code is not logged in')).toHaveLength(1);
    expect(screen.queryByText(/OpenAI Codex is not logged in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cursor/i)).not.toBeInTheDocument();
  });

  it('should show no toast before the first answer', () => {
    renderApp();

    expect(screen.queryByText(/is not logged in/)).not.toBeInTheDocument();
  });

  it('should start the login from the toast and follow it', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);

    await user.click(await screen.findByRole('button', { name: 'Authenticate' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
    expect(await screen.findByText('Starting the Claude Code login…')).toBeInTheDocument();

    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'AB12-CD34' });

    const link = await screen.findByRole('link', { name: /Open login page/ });
    expect(link).toHaveAttribute('href', 'https://claude.com/oauth');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await screen.findAllByText('AB12-CD34', {})).length).toBeGreaterThan(0);
  });

  it('should never render a link that is not https', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);

    emitLogin(connection, 'claude', { kind: 'url', url: 'javascript:alert(1)' });

    await screen.findByText('Log in to Claude Code');
    expect(screen.queryAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/settings']);
  });

  it('should cancel a login from the toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sentOfType(connection, 'auth.cancel')).toEqual([{ type: 'auth.cancel', agentId: 'claude' }]);
  });

  it('should open the Agents section from the toast to type a code the browser shows, and send it', async () => {
    const { connection, router } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });

    await enterCode(connection, user);
    expect(router.state.location.pathname).toBe('/settings/agents');
    const input = await screen.findByLabelText('Paste the code the browser shows');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(input, '  abc#def  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sentOfType(connection, 'auth.input')).toEqual([{ type: 'auth.input', agentId: 'claude', text: 'abc#def' }]);
    expect(input).not.toBeInTheDocument();
  });

  it('should keep the login toast after its action opens the code input', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });

    const enterCode = await screen.findByRole('button', { name: 'Enter code' });
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(enterCode);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Sonner removes a toast 200 ms after an action click that does not prevent the default.
    act(() => {
      rs.advanceTimersByTime(400);
    });

    expect(screen.getByText('Log in to Claude Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
  });

  it('should tell the user the code is being checked, in the dialog and in the toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await enterCode(connection, user);
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'abc#def');

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Checking the code…');
    await waitFor(() => expect(screen.getAllByText('Checking the code…')).toHaveLength(2));
    expect(screen.queryByLabelText('Paste the code the browser shows')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open login page/ })).toBeInTheDocument();
  });

  it('should ask for the code again when the login did not accept it', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await enterCode(connection, user);
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');

    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Invalid code.' });

    expect(await screen.findByRole('alert')).toHaveTextContent('That code was not accepted. Paste it again.');
    expect(screen.getByLabelText('Paste the code the browser shows')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should keep the link while the code is checked and when a late link arrives', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await enterCode(connection, user);
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');

    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth2' });

    expect(await screen.findByRole('link', { name: /Open login page/ })).toHaveAttribute('href', 'https://claude.com/oauth2');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should cancel a login that waits for a pasted code from its toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sentOfType(connection, 'auth.cancel')).toEqual([{ type: 'auth.cancel', agentId: 'claude' }]);
  });

  it('should not send a blank code', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await enterCode(connection, user);
    const input = await screen.findByLabelText('Paste the code the browser shows');

    await user.type(input, '   {Enter}');

    expect(sentOfType(connection, 'auth.input')).toEqual([]);
  });

  it('should keep a failed login on screen with a way to try again', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'failed', reason: 'Invalid code.' });

    expect(await screen.findByText('Claude Code login failed')).toBeInTheDocument();
    expect(screen.getByText('Invalid code.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
  });

  it('should thank the user and refresh when a login completes, then clear the toast', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    await screen.findByText('Claude Code is not logged in');

    emitLogin(connection, 'claude', { kind: 'completed' });
    expect(await screen.findByText('Claude Code is logged in')).toBeInTheDocument();
    expect(sentOfType(connection, 'auth.status')).toContainEqual({ type: 'auth.status', refresh: true });
    emitStatus(connection, ['claude', 'authenticated']);

    await waitFor(() => expect(screen.queryByText('Claude Code is not logged in')).not.toBeInTheDocument());
  });

  it('should thank with the agent id when the name was never listed', async () => {
    const { connection } = renderApp();

    emitLogin(connection, 'mystery', { kind: 'completed' });

    expect(await screen.findByText('mystery is logged in')).toBeInTheDocument();
  });

  it('should remove the toast of an agent that is logged in or has disappeared', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated'], ['codex', 'unauthenticated']);
    await screen.findByText('Claude Code is not logged in');
    await screen.findByText('OpenAI Codex is not logged in');

    emitStatus(connection, ['claude', 'authenticated']);

    await waitFor(() => {
      expect(screen.queryByText('Claude Code is not logged in')).not.toBeInTheDocument();
      expect(screen.queryByText('OpenAI Codex is not logged in')).not.toBeInTheDocument();
    });
  });

  it('should ignore a failed check', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    await screen.findByText('Claude Code is not logged in');

    act(() => connection.emitEvent({ type: 'auth.status.failed' }));

    expect(screen.getByText('Claude Code is not logged in')).toBeInTheDocument();
  });
});
