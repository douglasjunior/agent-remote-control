import type { AgentQuotaReport } from '@agent-remote-control/protocol/agent-quota';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FakeServerConnection } from '../../test/fake-server-connection.js';
import { renderApp } from '../../test/render-app.js';


function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function ok(name: string, ...buckets: { window: string; remainingFraction: number; resetTime?: string }[]): AgentQuotaReport {
  return {
    agent: { id: name, name },
    status: 'ok',
    quota: {
      groups: [
        {
          name: 'Limits',
          buckets: buckets.map((bucket, index) => ({ id: String(index), name: `Bucket ${index}`, ...bucket })),
        },
      ],
    },
  };
}

function emitReports(connection: FakeServerConnection, reports: readonly AgentQuotaReport[], fetchedAt = new Date().toISOString()) {
  act(() => connection.emitEvent({ type: 'quota.report', reports, fetchedAt }));
}

async function openPanel() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^Agent usage/ }));
  return user;
}

describe('UsageIndicator', () => {
  it('asks for the usage when the app connects and shows a dash until it arrives', () => {
    const { connection } = renderApp();

    expect(connection.sent).toContainEqual({ type: 'quota.get' });
    const trigger = screen.getByRole('button', { name: 'Agent usage' });
    expect(trigger).toHaveTextContent('–');
  });

  it('shows one meter per agent and the lowest percent left', () => {
    const { connection } = renderApp();
    emitReports(connection, [
      ok('Claude Code', { window: '5h', remainingFraction: 0.8 }, { window: '7d', remainingFraction: 0.35 }),
      ok('Codex', { window: '5h', remainingFraction: 0.12 }),
      { agent: { id: 'cursor', name: 'Cursor' }, status: 'unsupported' },
    ]);

    const trigger = screen.getByRole('button', { name: 'Agent usage, lowest 12% left' });
    expect(trigger).toHaveTextContent('12%');
    const levels = [...trigger.querySelectorAll('[data-level]')].map(meter => meter.getAttribute('data-level'));
    expect(levels).toEqual(['attention', 'critical']);
  });

  it('opens the limits of each agent', async () => {
    const { connection } = renderApp();
    emitReports(connection, [
      ok('Claude Code', { window: '5h', remainingFraction: 0.8, resetTime: inHours(3) }, { window: '7d', remainingFraction: 0.35 }),
      { agent: { id: 'cursor', name: 'Cursor' }, status: 'unsupported' },
      { agent: { id: 'agy', name: 'Antigravity' }, status: 'failed' },
    ]);

    await openPanel();
    const panel = within(screen.getByRole('dialog'));

    expect(panel.getByRole('heading', { name: 'Agent usage' })).toBeInTheDocument();
    expect(panel.getByText('Updated just now')).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    expect(panel.getByText('5h')).toBeInTheDocument();
    expect(panel.getByText('80%')).toBeInTheDocument();
    expect(panel.getByText('3h')).toBeInTheDocument();
    expect(panel.getByText('resets in 3 hours')).toBeInTheDocument();
    expect(panel.getByText('Week')).toBeInTheDocument();
    expect(panel.getByText('35%')).toBeInTheDocument();
    expect(panel.getByText('No usage data')).toBeInTheDocument();
    expect(panel.getByText('Could not read usage')).toBeInTheDocument();
  });

  it('tells apart the limits of a group that share a window', async () => {
    const { connection } = renderApp();
    emitReports(connection, [
      {
        agent: { id: 'claude', name: 'Claude Code' },
        status: 'ok',
        quota: {
          groups: [
            {
              name: 'Claude Code',
              buckets: [
                { id: 'all', name: 'Current week (all models)', window: '7d', remainingFraction: 0.6 },
                { id: 'sonnet', name: 'Current week (Sonnet only)', window: '7d', remainingFraction: 0.1 },
              ],
            },
          ],
        },
      },
    ]);

    await openPanel();
    const panel = within(screen.getByRole('dialog'));

    expect(panel.getByText('Week · all models')).toBeInTheDocument();
    expect(panel.getByText('Week · Sonnet only').closest('li')).toHaveAttribute('data-level', 'critical');
  });

  it('names a group only when the agent has more than one', async () => {
    const { connection } = renderApp();
    emitReports(connection, [
      ok('Claude Code', { window: '5h', remainingFraction: 0.8 }),
      {
        agent: { id: 'agy', name: 'Antigravity' },
        status: 'ok',
        quota: {
          groups: ['Gemini', 'Claude'].map(name => ({
            name,
            buckets: [{ id: name, name: 'Requests', window: '5h', remainingFraction: 0.5 }],
          })),
        },
      },
    ]);

    await openPanel();
    const panel = within(screen.getByRole('dialog'));

    expect(panel.getByText('Gemini')).toBeInTheDocument();
    expect(panel.getByText('Claude')).toBeInTheDocument();
    expect(panel.queryByText('Limits')).not.toBeInTheDocument();
  });

  it.each([
    ['a passed reset', -1, null],
    ['a reset under a minute away', 0.001, 'resets in under a minute'],
  ])('handles %s', async (_name, hours, label) => {
    const { connection } = renderApp();
    emitReports(connection, [ok('Codex', { window: '5h', remainingFraction: 0.5, resetTime: inHours(hours) })]);

    await openPanel();

    const panel = within(screen.getByRole('dialog'));
    if (label === null) {
      expect(panel.queryByText(/^resets/)).not.toBeInTheDocument();
    } else {
      expect(panel.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the reading state and then explains that no agent exists', async () => {
    const { connection } = renderApp();

    await openPanel();
    expect(screen.getByText('Reading the limits…')).toBeInTheDocument();

    emitReports(connection, []);
    expect(screen.queryByText('Reading the limits…')).not.toBeInTheDocument();
    expect(screen.getByText('No agent CLI was found in the PATH.')).toBeInTheDocument();
  });

  it('refreshes on demand and disables the button until the answer arrives', async () => {
    const { connection } = renderApp();
    emitReports(connection, [ok('Codex', { window: '5h', remainingFraction: 0.5 })]);
    const user = await openPanel();

    const refresh = screen.getByRole('button', { name: 'Refresh usage' });
    await user.click(refresh);

    expect(connection.sent).toContainEqual({ type: 'quota.get', refresh: true });
    expect(refresh).toBeDisabled();

    emitReports(connection, [ok('Codex', { window: '5h', remainingFraction: 0.4 })]);
    expect(refresh).toBeEnabled();
    expect(within(screen.getByRole('dialog')).getByText('40%')).toBeInTheDocument();
  });

  it('keeps the numbers and says so when a refresh fails', async () => {
    const { connection } = renderApp();
    emitReports(connection, [ok('Codex', { window: '5h', remainingFraction: 0.5 })]);
    await openPanel();

    act(() => connection.emitEvent({ type: 'quota.failed' }));

    expect(screen.getByText('Could not refresh')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('50%')).toBeInTheDocument();
  });

  it('leaves the reading state when the first query fails', async () => {
    const { connection } = renderApp();
    act(() => connection.emitEvent({ type: 'quota.failed' }));

    await openPanel();

    expect(screen.getByText('Could not refresh')).toBeInTheDocument();
    expect(screen.queryByText('Reading the limits…')).not.toBeInTheDocument();
  });
});
