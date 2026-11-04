import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { openConversation, roleProfiles, type AppHarness } from '../test/render-app.js';


async function openSettings(options: { configured?: boolean } = {}) {
  const user = userEvent.setup();
  const app = openConversation(options);
  act(() => app.connection.emitEvent({
    type: 'agents.list',
    agents: [{ id: 'codex', name: 'Codex' }, { id: 'claude', name: 'Claude Code' }],
  }));
  if (options.configured !== false) {
    await user.click(screen.getByRole('button', { name: /Settings/ }));
  }
  return { user, ...app };
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Settings' });
}

function emit(app: AppHarness, event: Parameters<AppHarness['connection']['emitEvent']>[0]) {
  act(() => app.connection.emitEvent(event));
}

describe('SettingsSheet', () => {
  it('lists each role profile and flags uninstalled agents', async () => {
    const app = openConversation();
    emit(app, {
      type: 'profiles',
      conversationId: 'c1',
      configured: true,
      profiles: [
        { ...roleProfiles[0], agent: { id: 'codex', name: 'Codex', available: false }, model: { id: 'm', name: 'GPT' }, effort: { id: 'e', name: 'High' } },
        roleProfiles[1],
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /Settings/ }));

    expect(within(dialog()).getByText('Codex · GPT · High')).toBeInTheDocument();
    expect(within(dialog()).getByText('not installed')).toBeInTheDocument();
    expect(within(dialog()).getByText('Not configured')).toBeInTheDocument();
  });

  it('chains agent, model and effort into profiles.set for every role', async () => {
    const { user, connection } = await openSettings();

    await user.click(within(dialog()).getByRole('button', { name: 'Codex' }));
    expect(connection.sent).toContainEqual({ type: 'models.list', agentId: 'codex' });
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Loading models…');

    act(() => connection.emitEvent({ type: 'models.list', agentId: 'other', models: [] }));
    expect(within(dialog()).getByRole('status')).toBeInTheDocument();
    act(() => connection.emitEvent({ type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT' }] }));
    await user.click(within(dialog()).getByRole('button', { name: 'GPT' }));
    expect(connection.sent).toContainEqual({ type: 'efforts.list', agentId: 'codex', modelId: 'gpt' });
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Loading efforts…');

    act(() => connection.emitEvent({ type: 'efforts.list', agentId: 'codex', modelId: 'other', efforts: [] }));
    expect(within(dialog()).getByRole('status')).toBeInTheDocument();
    act(() => connection.emitEvent({ type: 'efforts.list', agentId: 'codex', modelId: 'gpt', efforts: [{ id: 'high', name: 'High' }] }));
    await user.click(within(dialog()).getByRole('button', { name: 'High' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'profiles.set', conversationId: 'c1', agentId: 'codex', modelId: 'gpt', effortId: 'high',
    });

    act(() => connection.emitEvent({ type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies only to the selected roles', async () => {
    const { user, connection } = await openSettings();
    expect(within(dialog()).getByText('Every role')).toBeInTheDocument();

    const developer = within(dialog()).getByRole('button', { name: 'Developer' });
    await user.click(developer);
    expect(developer).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog()).getByText('1 selected')).toBeInTheDocument();
    await user.click(developer);
    expect(within(dialog()).getByText('Every role')).toBeInTheDocument();
    await user.click(developer);

    await user.click(within(dialog()).getByRole('button', { name: 'Codex' }));
    act(() => connection.emitEvent({ type: 'models.list', agentId: 'codex', models: [] }));
    await user.click(within(dialog()).getByRole('button', { name: 'Use this agent' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'profiles.set', conversationId: 'c1', roles: ['DEVELOPER'], agentId: 'codex',
    });
  });

  it('skips the effort step when the model has none', async () => {
    const { user, connection } = await openSettings();
    await user.click(within(dialog()).getByRole('button', { name: 'Claude Code' }));
    act(() => connection.emitEvent({ type: 'models.list', agentId: 'claude', models: [{ id: 'opus', name: 'Opus' }] }));
    await user.click(within(dialog()).getByRole('button', { name: 'Opus' }));
    act(() => connection.emitEvent({ type: 'efforts.list', agentId: 'claude', modelId: 'opus', efforts: [] }));
    await user.click(within(dialog()).getByRole('button', { name: 'Use this model' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'profiles.set', conversationId: 'c1', agentId: 'claude', modelId: 'opus',
    });
  });

  it('shows errors and returns to the agent step', async () => {
    const { user, connection } = await openSettings();
    await user.click(within(dialog()).getByRole('button', { name: 'Codex' }));

    act(() => connection.emitEvent({ type: 'error', message: 'Other conversation', conversationId: 'zzz' }));
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();

    act(() => connection.emitEvent({ type: 'error', message: 'Agent unavailable' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Agent unavailable');
    expect(within(dialog()).getByText('Choose an agent')).toBeInTheDocument();

    act(() => connection.emitEvent({ type: 'error', message: 'Again', conversationId: 'c1' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Again');

    await user.click(within(dialog()).getByRole('button', { name: 'Codex' }));
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays open for profiles events it did not request', async () => {
    const { connection } = await openSettings();
    act(() => connection.emitEvent({ type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles }));
    expect(dialog()).toBeInTheDocument();
  });

  it('can be dismissed when the conversation is unconfigured', async () => {
    const { user } = await openSettings({ configured: false });
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
