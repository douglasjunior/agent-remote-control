import type { AgentLoginEvent } from '@agent-remote-control/protocol/agent-auth';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import type { FakeServerConnection } from '../../test/fake-server-connection.js';
import { renderApp } from '../../test/render-app.js';


const AT = '2026-01-01T00:00:00.000Z';
type Status = 'authenticated' | 'unauthenticated' | 'unknown';

function emitStatus(connection: FakeServerConnection, ...entries: [string, Status, string?][]) {
  act(() => connection.emitEvent({
    type: 'auth.status',
    fetchedAt: AT,
    agents: entries.map(([agentId, status, detail]) => ({
      agentId,
      displayName: agentId === 'claude' ? 'Claude Code' : 'OpenAI Codex',
      status,
      ...(detail ? { detail } : {}),
    })),
  }));
}

function emitLogin(connection: FakeServerConnection, agentId: string, event: AgentLoginEvent) {
  act(() => connection.emitEvent({ type: 'auth.login', agentId, event }));
}

const sentOfType = (connection: FakeServerConnection, type: string) =>
  connection.sent.filter(command => command.type === type);

// Each case mounts the whole app and waits on sonner's animated toasts, which is slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

describe('AgentAuthController', () => {
  afterEach(() => {
    toast.dismiss();
  });

  it('asks for the login state when the app connects', () => {
    const { connection } = renderApp();

    expect(sentOfType(connection, 'auth.status')).toEqual([{ type: 'auth.status' }]);
  });

  it('shows a persistent toast for an agent that is not logged in, once, and none for the others', async () => {
    const { connection } = renderApp();

    emitStatus(connection, ['claude', 'unauthenticated'], ['codex', 'authenticated'], ['cursor', 'unknown']);
    emitStatus(connection, ['claude', 'unauthenticated'], ['codex', 'authenticated'], ['cursor', 'unknown']);

    expect(await screen.findAllByText('Claude Code is not logged in')).toHaveLength(1);
    expect(screen.queryByText(/OpenAI Codex is not logged in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cursor/i)).not.toBeInTheDocument();
  });

  it('shows no toast before the first answer', () => {
    renderApp();

    expect(screen.queryByText(/is not logged in/)).not.toBeInTheDocument();
  });

  it('starts the login from the toast and follows it', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);

    await user.click(await screen.findByRole('button', { name: 'Authenticate' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
    expect(await screen.findByText('Starting the Claude Code login…')).toBeInTheDocument();

    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'AB12-CD34' });

    const link = await screen.findByRole('link', { name: /Open login page/ }, { timeout: 5000 });
    expect(link).toHaveAttribute('href', 'https://claude.com/oauth');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await screen.findAllByText('AB12-CD34', {}, { timeout: 5000 })).length).toBeGreaterThan(0);
  });

  it('never renders a link that is not https', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);

    emitLogin(connection, 'claude', { kind: 'url', url: 'javascript:alert(1)' });

    await screen.findByText('Log in to Claude Code');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('cancels a login from the toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sentOfType(connection, 'auth.cancel')).toEqual([{ type: 'auth.cancel', agentId: 'claude' }]);
  });

  it('opens the popover from the toast to type a code the browser shows, and sends it', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });

    await user.click(await screen.findByRole('button', { name: 'Enter code' }));
    const input = await screen.findByLabelText('Paste the code the browser shows');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(input, '  abc#def  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sentOfType(connection, 'auth.input')).toEqual([{ type: 'auth.input', agentId: 'claude', text: 'abc#def' }]);
    expect(input).not.toBeInTheDocument();
  });

  it('tells the user the code is being checked, in the dialog and in the toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await user.click(await screen.findByRole('button', { name: 'Enter code' }));
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'abc#def');

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Checking the code…');
    expect(await screen.findAllByText('Checking the code…')).toHaveLength(2);
    expect(screen.queryByLabelText('Paste the code the browser shows')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open login page/ })).toBeInTheDocument();
  });

  it('asks for the code again when the login did not accept it', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await user.click(await screen.findByRole('button', { name: 'Enter code' }));
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');

    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Invalid code.' });

    expect(await screen.findByRole('alert')).toHaveTextContent('That code was not accepted. Paste it again.');
    expect(screen.getByLabelText('Paste the code the browser shows')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the link while the code is checked and when a late link arrives', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth' });
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await user.click(await screen.findByRole('button', { name: 'Enter code' }));
    await user.type(await screen.findByLabelText('Paste the code the browser shows'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');

    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth2' });

    expect(await screen.findByRole('link', { name: /Open login page/ })).toHaveAttribute('href', 'https://claude.com/oauth2');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('cancels a login that waits for a pasted code from its toast', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sentOfType(connection, 'auth.cancel')).toEqual([{ type: 'auth.cancel', agentId: 'claude' }]);
  });

  it('does not send a blank code', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'prompt', hint: 'Paste code here >' });
    await user.click(await screen.findByRole('button', { name: 'Enter code' }));
    const input = await screen.findByLabelText('Paste the code the browser shows');

    await user.type(input, '   {Enter}');

    expect(sentOfType(connection, 'auth.input')).toEqual([]);
  });

  it('keeps a failed login on screen with a way to try again', async () => {
    const { connection } = renderApp();
    const user = userEvent.setup();
    emitStatus(connection, ['claude', 'unauthenticated']);
    emitLogin(connection, 'claude', { kind: 'failed', reason: 'Invalid code.' });

    expect(await screen.findByText('Claude Code login failed')).toBeInTheDocument();
    expect(screen.getByText('Invalid code.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
  });

  it('thanks the user and refreshes when a login completes, then clears the toast', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    await screen.findByText('Claude Code is not logged in');

    emitLogin(connection, 'claude', { kind: 'completed' });
    expect(await screen.findByText('Claude Code is logged in')).toBeInTheDocument();
    expect(sentOfType(connection, 'auth.status')).toContainEqual({ type: 'auth.status', refresh: true });
    emitStatus(connection, ['claude', 'authenticated']);

    await waitFor(() => expect(screen.queryByText('Claude Code is not logged in')).not.toBeInTheDocument());
  });

  it('thanks with the agent id when the name was never listed', async () => {
    const { connection } = renderApp();

    emitLogin(connection, 'mystery', { kind: 'completed' });

    expect(await screen.findByText('mystery is logged in')).toBeInTheDocument();
  });

  it('removes the toast of an agent that is logged in or has disappeared', async () => {
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

  it('ignores a failed check', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    await screen.findByText('Claude Code is not logged in');

    act(() => connection.emitEvent({ type: 'auth.status.failed' }));

    expect(screen.getByText('Claude Code is not logged in')).toBeInTheDocument();
  });
});

describe('AgentAuthPopover', () => {
  const open = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Agent logins/ }));
    return user;
  };

  it('says it is checking until the first answer, and lists nothing for an empty one', async () => {
    const { connection } = renderApp();
    await open();
    expect(screen.getByText('Checking the agents…')).toBeInTheDocument();

    emitStatus(connection);

    expect(await screen.findByText('No agent supports login here.')).toBeInTheDocument();
  });

  it('lists every agent with its state, account and button', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'authenticated', 'me@example.com'], ['codex', 'unauthenticated'], ['cursor', 'unknown']);
    await open();

    const claude = screen.getByText('Claude Code').closest('li')!;
    expect(within(claude).getByText('Logged in')).toBeInTheDocument();
    expect(within(claude).getByText('me@example.com')).toBeInTheDocument();
    expect(within(claude).getByRole('button', { name: 'Re-authenticate Claude Code' })).toBeInTheDocument();
    const codex = screen.getAllByText('OpenAI Codex')[0]!.closest('li')!;
    expect(within(codex).getByText('Not logged in')).toBeInTheDocument();
    expect(within(codex).getByRole('button', { name: 'Authenticate OpenAI Codex' })).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('flags the header button when an agent needs a login', () => {
    const { connection } = renderApp();
    expect(screen.getByRole('button', { name: 'Agent logins' })).toBeInTheDocument();

    emitStatus(connection, ['claude', 'unauthenticated']);

    expect(screen.getByRole('button', { name: 'Agent logins, login needed' })).toBeInTheDocument();
  });

  it('starts a login from its button and shows the card with link, code and waiting state', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'authenticated']);
    const user = await open();

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

  it('copies the one-time code', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'authenticated']);
    const user = await open();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Re-authenticate Claude Code' }));
    emitLogin(connection, 'claude', { kind: 'url', url: 'https://claude.com/oauth', code: 'AB12-CD34' });

    const card = await screen.findByLabelText('Claude Code login');
    await user.click(within(card).getByRole('button', { name: 'Copy code' }));

    expect(writeText).toHaveBeenCalledWith('AB12-CD34');
  });

  it('shows the reason a login failed and lets the user start again', async () => {
    const { connection } = renderApp();
    emitStatus(connection, ['claude', 'unauthenticated']);
    const user = await open();
    emitLogin(connection, 'claude', { kind: 'failed', reason: 'Invalid code.' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code.');
    await user.click(screen.getByRole('button', { name: 'Authenticate Claude Code' }));

    expect(sentOfType(connection, 'auth.login')).toEqual([{ type: 'auth.login', agentId: 'claude' }]);
  });
});
