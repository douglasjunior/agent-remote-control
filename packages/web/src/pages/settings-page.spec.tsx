import type { SettingView } from '@agent-remote-control/protocol/settings';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { openConversation, renderApp } from '../test/render-app.js';


const SETTINGS: SettingView[] = [
  { key: 'USER_LANGUAGE', group: 'general', apply: 'live', source: 'default', kind: 'text', value: 'English', defaultValue: 'English' },
  { key: 'DISCORD_ENABLED', group: 'discord', apply: 'live', source: 'default', kind: 'boolean', value: true, defaultValue: true },
  { key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', source: 'default', kind: 'secret', value: { set: false } },
  { key: 'DISCORD_GUILD_ID', group: 'discord', apply: 'live', source: 'env', kind: 'text', value: '12345678901234567', defaultValue: '' },
  { key: 'QUESTION_TIMEOUT_MS', group: 'general', apply: 'live', source: 'saved', kind: 'integer', value: 300_000, defaultValue: 300_000 },
  { key: 'LOG_RETENTION_DAYS', group: 'general', apply: 'live', source: 'default', kind: 'integer', value: 14, defaultValue: 14 },
  { key: 'STT_PROVIDER', group: 'speech', apply: 'restart', source: 'default', kind: 'choice', value: 'whisper-cpp', defaultValue: 'whisper-cpp', options: ['whisper-cpp', 'none'] },
];

const withSetting = (key: string, changes: Partial<SettingView>): SettingView[] =>
  SETTINGS.map(view => (view.key === key ? { ...view, ...changes } as SettingView : view));

function openSettings(settings = SETTINGS) {
  const app = renderApp('/settings');
  act(() => app.connection.emitEvent({ type: 'settings', settings }));
  return app;
}

const field = (label: string) => screen.getByRole('group', { name: label });
const lastSent = (connection: ReturnType<typeof renderApp>['connection']) => connection.sent.at(-1);

afterEach(() => {
  act(() => toast.dismiss());
});

describe('SettingsPage', () => {
  it('should ask for the settings once connected and show them by section, with where each value comes from', () => {
    const { connection } = renderApp('/settings');

    expect(connection.sent).toContainEqual({ type: 'settings.get' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings…');
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));

    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['General', 'Discord', 'Speech-to-text']);
    expect(within(field('Language')).getByText('Default')).toBeInTheDocument();
    expect(within(field('Language')).queryByText('USER_LANGUAGE')).not.toBeInTheDocument();
    expect(within(field('Server ID')).getByText('Environment')).toBeInTheDocument();
    expect(within(field('Server ID')).getByText('DISCORD_GUILD_ID')).toBeInTheDocument();
    expect(within(field('Question timeout')).getByText('Saved')).toBeInTheDocument();
    expect(within(field('Question timeout')).getByText('milliseconds · 5m')).toBeInTheDocument();
    expect(within(field('Log retention')).getByText('days')).toBeInTheDocument();
    expect(within(field('Provider')).getByText('Applies when the server restarts.')).toBeInTheDocument();
  });

  it('should check a field as it is typed and save every change together, for every open page', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    const timeout = within(field('Question timeout')).getByRole('textbox');

    await user.clear(timeout);
    await user.type(timeout, 'soon');
    expect(within(field('Question timeout')).getByRole('alert')).toHaveTextContent('Use a whole number');
    expect(within(field('Question timeout')).getByText('milliseconds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.clear(timeout);
    await user.type(timeout, '0');
    expect(within(field('Question timeout')).getByText('milliseconds · off')).toBeInTheDocument();
    await user.click(within(field('Discord bot')).getByRole('switch'));
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(within(field('Discord bot')).getByText('Unsaved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { DISCORD_ENABLED: false, QUESTION_TIMEOUT_MS: 0 } });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('QUESTION_TIMEOUT_MS', { value: 0 }) }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(timeout).toHaveValue('0');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('should show the message of a change the server refuses and keep it to try again', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    await user.clear(within(field('Language')).getByRole('textbox'));
    await user.type(within(field('Language')).getByRole('textbox'), 'Spanish');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    act(() => connection.emitEvent({ type: 'error', message: 'USER_LANGUAGE: Leave out < > [ ] and backticks' }));

    expect(screen.getByRole('alert')).toHaveTextContent('USER_LANGUAGE: Leave out < > [ ] and backticks');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    act(() => connection.emitEvent({ type: 'error', message: 'Unknown conversation', conversationId: 'c1' }));
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();
  });

  it('should discard the changes, and reset a saved value to its variable or default', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    await user.type(within(field('Log retention')).getByRole('textbox'), '0');

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(field('Log retention')).getByRole('textbox')).toHaveValue('14');
    expect(within(field('Language')).queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();

    await user.click(within(field('Question timeout')).getByRole('button', { name: 'Reset to default' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.reset', keys: ['QUESTION_TIMEOUT_MS'] });
  });

  it('should take a new secret without ever showing the saved one, and clear it', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    const token = () => field('Bot token');
    expect(within(token()).getByText('Not set')).toBeInTheDocument();
    expect(within(token()).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    await user.click(within(token()).getByRole('button', { name: 'Set' }));
    await user.type(within(token()).getByLabelText('Bot token'), 'x');
    await user.clear(within(token()).getByLabelText('Bot token'));
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await user.type(within(token()).getByLabelText('Bot token'), 'new-token');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { DISCORD_BOT_TOKEN: 'new-token' } });
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('DISCORD_BOT_TOKEN', { source: 'saved', value: { set: true } }) }));

    expect(within(token()).getByText('Set')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('new-token')).not.toBeInTheDocument();
    await user.click(within(token()).getByRole('button', { name: 'Clear' }));
    expect(within(token()).getByText('Cleared when you save')).toBeInTheDocument();
    await user.click(within(token()).getByRole('button', { name: 'Undo' }));
    await user.click(within(token()).getByRole('button', { name: 'Replace' }));
    await user.click(within(token()).getByRole('button', { name: 'Cancel' }));
    expect(within(token()).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    await user.click(within(token()).getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { DISCORD_BOT_TOKEN: '' } });
  });

  it('should tell to restart the server once a setting that applies on restart is saved', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();

    await user.click(within(field('Provider')).getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'none' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('STT_PROVIDER', { source: 'saved', value: 'none' }) }));

    expect(screen.getByText('Restart the server to apply Provider.')).toBeInTheDocument();
  });

  it('should test the Discord token typed in the form with the server of the form, before saving', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    await user.click(within(field('Bot token')).getByRole('button', { name: 'Set' }));
    await user.type(within(field('Bot token')).getByLabelText('Bot token'), 'typed-token');
    await user.clear(within(field('Server ID')).getByRole('textbox'));
    await user.type(within(field('Server ID')).getByRole('textbox'), '22222222222222222');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.discord.test', token: 'typed-token', guildId: '22222222222222222' });
    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
    act(() => connection.emitEvent({ type: 'settings.discord.test.result', ok: true, botName: 'arc-bot', guildName: 'Home' }));
    expect(screen.getByText(/Connected as/)).toHaveTextContent('Connected as arc-bot in Home.');
  });

  it('should test the saved token with the saved server, and show why a test failed', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();

    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(lastSent(connection)).toEqual({ type: 'settings.discord.test', guildId: '12345678901234567' });
    act(() => connection.emitEvent({ type: 'settings.discord.test.result', ok: true, botName: 'arc-bot' }));
    expect(screen.getByText(/Connected as/)).toHaveTextContent('Connected as arc-bot.');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    act(() => connection.emitEvent({ type: 'settings.discord.test.result', ok: false, error: 'Discord refused the token.' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Discord refused the token.');
  });

  it('should send no server to test when the settings hold none it knows', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS.filter(view => view.key !== 'DISCORD_GUILD_ID'));

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.discord.test' });
  });

  it('should show a setting and a section this page does not know by their keys', () => {
    openSettings([{ key: 'NEW_SETTING', group: 'future', apply: 'live', source: 'default', kind: 'text', value: '', defaultValue: '' }]);

    expect(screen.getByRole('heading', { name: 'future' })).toBeInTheDocument();
    expect(field('NEW_SETTING')).toBeInTheDocument();
  });

  it('should be reached from the header and close back to the page it was opened from', async () => {
    const user = userEvent.setup();
    const { router } = openConversation();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(router.state.location.pathname).toBe('/settings');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(router.state.location.pathname).toBe('/c/c1');
  });

  it('should close to the start when it was opened from its address', async () => {
    const user = userEvent.setup();
    const { router } = openSettings();

    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(router.state.location.pathname).toBe('/');
  });
});
