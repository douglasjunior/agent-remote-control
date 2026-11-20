import type { SettingView } from '@agent-remote-control/protocol/settings';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { openConversation, renderApp } from '../test/render-app.js';


const SETTINGS: SettingView[] = [
  { key: 'USER_LANGUAGE', group: 'general', apply: 'live', envOnly: false, source: 'default', kind: 'text', value: 'English', defaultValue: 'English' },
  { key: 'DISCORD_ENABLED', group: 'discord', apply: 'live', envOnly: false, source: 'default', kind: 'boolean', value: true, defaultValue: true },
  { key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', envOnly: false, source: 'default', kind: 'secret', value: { set: false } },
  { key: 'DISCORD_GUILD_ID', group: 'discord', apply: 'live', envOnly: false, source: 'env', kind: 'text', value: '12345678901234567', defaultValue: '' },
  { key: 'QUESTION_TIMEOUT_MS', group: 'general', apply: 'live', envOnly: false, source: 'saved', kind: 'integer', value: 300_000, defaultValue: 300_000 },
  { key: 'AGENT_AUTH_STATUS_TIMEOUT_MS', group: 'agents', apply: 'live', envOnly: false, source: 'default', kind: 'integer', value: 10_000, defaultValue: 10_000 },
  { key: 'LOG_RETENTION_DAYS', group: 'general', apply: 'live', envOnly: false, source: 'default', kind: 'integer', value: 14, defaultValue: 14 },
  { key: 'STT_PROVIDER', group: 'speech', apply: 'restart', envOnly: false, source: 'default', kind: 'choice', value: 'whisper-cpp', defaultValue: 'whisper-cpp', options: ['whisper-cpp', 'none'] },
];

const withSetting = (key: string, changes: Partial<SettingView>): SettingView[] =>
  SETTINGS.map(view => (view.key === key ? { ...view, ...changes } as SettingView : view));

function openSettings(settings = SETTINGS, tab?: string) {
  const app = renderApp(tab ? `/settings?tab=${tab}` : '/settings');
  act(() => app.connection.emitEvent({ type: 'settings', settings }));
  return app;
}

const openTab = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
const field = (label: string) => screen.getByRole('group', { name: label });
const lastSent = (connection: ReturnType<typeof renderApp>['connection']) => connection.sent.at(-1);

afterEach(() => {
  act(() => toast.dismiss());
});

describe('SettingsPage', () => {
  it('should ask for the settings once connected and show them by tab and section, with where each value comes from', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp('/settings');

    expect(connection.sent).toContainEqual({ type: 'settings.get' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings…');
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['General', 'Discord', 'Agents', 'Squads', 'Advanced']);
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['General']);
    expect(within(field('Language')).getByText('Default')).toBeInTheDocument();
    expect(within(field('Language')).queryByText('USER_LANGUAGE')).not.toBeInTheDocument();

    await openTab(user, 'Discord');
    expect(within(field('Server ID')).getByText('Environment')).toBeInTheDocument();
    expect(within(field('Server ID')).getByText('DISCORD_GUILD_ID')).toBeInTheDocument();

    await openTab(user, 'Advanced');
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Sessions and logs', 'Speech-to-text']);
    expect(within(field('Question timeout')).getByText('Saved')).toBeInTheDocument();
    expect(within(field('Question timeout')).getByRole('textbox')).toHaveValue('5');
    expect(within(field('Question timeout')).getByText('minutes')).toBeInTheDocument();
    expect(within(field('Log retention')).getByText('days')).toBeInTheDocument();
    expect(within(field('Provider')).getByText('Applies when the server restarts.')).toBeInTheDocument();
  });

  it('should keep the open tab in the address, so a reload or a link opens it', async () => {
    const user = userEvent.setup();
    const { router } = openSettings();

    await openTab(user, 'Advanced');
    expect(router.state.location.search).toBe('?tab=advanced');
    expect(screen.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();

    await openTab(user, 'General');
    expect(router.state.location.search).toBe('');
    expect(field('Language')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('should open the tab named in the address, and the first one when the address names none it knows', async () => {
    const { router } = openSettings(SETTINGS, 'discord');
    expect(screen.getByRole('tab', { name: 'Discord' })).toHaveAttribute('aria-selected', 'true');
    expect(field('Server ID')).toBeInTheDocument();

    await act(() => router.navigate('/settings?tab=nowhere'));

    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('should still close to the page it was opened from after the tab changes', async () => {
    const user = userEvent.setup();
    const { router } = openConversation();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await openTab(user, 'Advanced');
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(router.state.location.pathname).toBe('/c/c1');
  });

  it('should link to the squads from their tab and come back to it', async () => {
    const user = userEvent.setup();
    const { router, connection } = openSettings(SETTINGS, 'squads');

    await user.click(screen.getByRole('link', { name: /Squads/ }));
    expect(router.state.location.pathname).toBe('/squads');
    act(() => connection.emitEvent({ type: 'squads', squads: [] }));
    await user.click(screen.getByRole('button', { name: 'Close squads' }));

    expect(router.state.location.pathname + router.state.location.search).toBe('/settings?tab=squads');
  });

  it('should keep the changes of every tab, mark the tabs that hold one and tell an invalid value apart', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

    await user.click(tab('Discord'));
    await user.click(within(field('Discord bot')).getByRole('switch'));
    await openTab(user, 'Advanced');
    await user.type(within(field('Question timeout')).getByRole('textbox'), 'x');
    await user.type(within(field('Log retention')).getByRole('textbox'), '2');

    expect(tab('Discord')).toHaveAccessibleName('Discord (has unsaved changes)');
    expect(tab('Advanced')).toHaveAccessibleName('Advanced (has an invalid value)');
    expect(tab('General')).toHaveAccessibleName('General');
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.type(within(field('Question timeout')).getByRole('textbox'), '{Backspace}');
    await openTab(user, 'Discord');
    expect(within(field('Discord bot')).getByText('Unsaved')).toBeInTheDocument();
    expect(tab('Advanced')).toHaveAccessibleName('Advanced (has unsaved changes)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { DISCORD_ENABLED: false, LOG_RETENTION_DAYS: 142 } });
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('LOG_RETENTION_DAYS', { source: 'saved', value: 142 }) }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(tab('Discord')).toHaveAccessibleName('Discord');
  });

  it('should show a setting only its variable sets read-only, with a tooltip that names the variable', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings([
      { key: 'SHELL_COMMAND_ENABLED', env: 'SHELL_COMMAND_ENABLED', envOnly: true, group: 'shell', apply: 'live', source: 'env', kind: 'boolean', value: true, defaultValue: false },
      { key: 'REMOTE_URL', env: 'REMOTE_URL', envOnly: true, group: 'remote', apply: 'live', source: 'default', kind: 'text', value: '', defaultValue: '' },
      { key: 'STT_FFMPEG_BIN', envOnly: true, group: 'speech', apply: 'live', source: 'default', kind: 'text', value: 'ffmpeg', defaultValue: 'ffmpeg' },
      { key: 'SHELL_COMMAND_TIMEOUT_MS', envOnly: true, group: 'shell', apply: 'live', source: 'env', kind: 'integer', value: 60_000, defaultValue: 60_000 },
      { key: 'TURN_RETRY_MAX_DELAY_MS', envOnly: true, group: 'turns', apply: 'live', source: 'env', kind: 'integer', value: 5_400_000, defaultValue: 7_200_000 },
      { key: 'TURN_RETRY_MAX_TOTAL_MS', envOnly: true, group: 'turns', apply: 'live', source: 'env', kind: 'integer', value: 90_000, defaultValue: 18_000_000 },
      { key: 'TURN_RETRY_BASE_DELAY_MS', envOnly: true, group: 'turns', apply: 'live', source: 'env', kind: 'integer', value: 15_000, defaultValue: 15_000 },
      { key: 'QUESTION_TIMEOUT_MS', envOnly: true, group: 'general', apply: 'live', source: 'env', kind: 'integer', value: 0, defaultValue: 300_000 },
      { key: 'FUTURE_LIMIT', envOnly: true, group: 'future', apply: 'live', source: 'env', kind: 'integer', value: 7, defaultValue: 1 },
      { key: 'FUTURE_SWITCH', envOnly: true, group: 'future', apply: 'live', source: 'default', kind: 'boolean', value: false, defaultValue: false },
      { key: 'FUTURE_SECRET', envOnly: true, group: 'future', apply: 'live', source: 'default', kind: 'secret', value: { set: false } },
      { key: 'FUTURE_TOKEN', envOnly: true, group: 'future', apply: 'live', source: 'env', kind: 'secret', value: { set: true } },
    ], 'advanced');

    const shell = field('Shell commands');
    expect(within(shell).getByText('Enabled')).toBeInTheDocument();
    expect(within(shell).getByText('Environment')).toBeInTheDocument();
    expect(within(shell).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(shell).queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
    expect(within(field('Signaling server')).getByText('Not set')).toBeInTheDocument();
    expect(within(field('Signaling server')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(field('ffmpeg executable')).getByText('ffmpeg')).toBeInTheDocument();
    expect(within(field('Command timeout')).getByText('1 minute')).toBeInTheDocument();
    expect(within(field('Longest wait')).getByText('90 minutes')).toBeInTheDocument();
    expect(within(field('Retry for')).getByText('1.5 minutes')).toBeInTheDocument();
    expect(within(field('First retry after')).getByText('15 seconds')).toBeInTheDocument();
    expect(within(field('Question timeout')).getByText('0 minutes · off')).toBeInTheDocument();
    expect(within(field('FUTURE_LIMIT')).getByText('7')).toBeInTheDocument();
    expect(within(field('FUTURE_TOKEN')).getByText('Set')).toBeInTheDocument();
    expect(within(field('FUTURE_SWITCH')).getByText('Disabled')).toBeInTheDocument();
    expect(within(field('FUTURE_SECRET')).getByText('Not set')).toBeInTheDocument();

    const hint = within(shell).getByRole('button', { name: 'Where this value is set' });
    while (document.activeElement !== hint) {
      await user.tab();
    }
    expect(await screen.findByText(
      content => content.startsWith('This value can only be set with the environment variable'),
      { selector: '[data-slot="tooltip-content"]' },
    )).toHaveTextContent('This value can only be set with the environment variable SHELL_COMMAND_ENABLED.');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(connection.sent).not.toContainEqual(expect.objectContaining({ type: 'settings.set' }));
  });

  it('should check a field as it is typed and save every change together, for every open page', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'advanced');
    const timeout = within(field('Question timeout')).getByRole('textbox');

    await user.clear(timeout);
    await user.type(timeout, 'soon');
    expect(within(field('Question timeout')).getByRole('alert')).toHaveTextContent('Use a number of minutes, such as 1.5');
    expect(within(field('Question timeout')).getByText('minutes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.clear(timeout);
    await user.type(timeout, '0');
    expect(within(field('Question timeout')).getByText('off')).toBeInTheDocument();
    await openTab(user, 'Discord');
    await user.click(within(field('Discord bot')).getByRole('switch'));
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(within(field('Discord bot')).getByText('Unsaved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { DISCORD_ENABLED: false, QUESTION_TIMEOUT_MS: 0 } });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('QUESTION_TIMEOUT_MS', { value: 0 }) }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    await openTab(user, 'Advanced');
    expect(within(field('Question timeout')).getByRole('textbox')).toHaveValue('0');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('should edit a time in minutes, with decimals, and save it in milliseconds', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'advanced');
    const timeout = () => within(field('Question timeout')).getByRole('textbox');

    expect(within(field('Question timeout')).queryByText('5m')).not.toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '1.5');
    expect(within(field('Question timeout')).getByText('1m 30s')).toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '120');
    expect(within(field('Question timeout')).getByText('2h')).toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { QUESTION_TIMEOUT_MS: 90_000 } });
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('QUESTION_TIMEOUT_MS', { value: 90_000 }) }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(timeout()).toHaveValue('1.5');
  });

  it('should edit a time in seconds where its default is under a minute', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'agents');
    const timeout = () => within(field('Login check timeout')).getByRole('textbox');

    expect(timeout()).toHaveValue('10');
    expect(within(field('Login check timeout')).getByText('seconds')).toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '90');
    expect(within(field('Login check timeout')).getByText('1m 30s')).toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '2.5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', changes: { AGENT_AUTH_STATUS_TIMEOUT_MS: 2_500 } });
  });

  it('should not count a time written another way as a change, and keep 0 only where it means off', async () => {
    const user = userEvent.setup();
    openSettings(SETTINGS, 'advanced');
    const timeout = () => within(field('Question timeout')).getByRole('textbox');

    await user.type(timeout(), '.0');
    expect(within(field('Question timeout')).queryByText('Unsaved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await user.clear(timeout());
    await user.type(timeout(), '0');
    expect(within(field('Question timeout')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();

    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    await user.clear(within(field('Login check timeout')).getByRole('textbox'));
    await user.type(within(field('Login check timeout')).getByRole('textbox'), '0');
    expect(within(field('Login check timeout')).getByRole('alert')).toHaveTextContent('Use a number above 0');
    expect(within(field('Login check timeout')).queryByText('off')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('should word the messages about a time in its unit', async () => {
    const user = userEvent.setup();
    openSettings(SETTINGS, 'agents');
    const timeout = () => within(field('Login check timeout')).getByRole('textbox');

    await user.clear(timeout());
    await user.type(timeout(), '1,5');
    expect(within(field('Login check timeout')).getByRole('alert')).toHaveTextContent('Use a number of seconds, such as 1.5');
    await user.clear(timeout());
    await user.type(timeout(), '99999999999999999999');
    expect(within(field('Login check timeout')).getByRole('alert')).toHaveTextContent('That is more seconds than can be saved');
    await user.clear(timeout());
    expect(within(field('Login check timeout')).getByRole('alert')).toHaveTextContent('Use a number of seconds, such as 1.5');
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
    const { connection } = openSettings(SETTINGS, 'advanced');
    await user.type(within(field('Log retention')).getByRole('textbox'), '0');

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(field('Log retention')).getByRole('textbox')).toHaveValue('14');
    expect(within(field('Log retention')).queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();

    await user.click(within(field('Question timeout')).getByRole('button', { name: 'Reset to default' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.reset', keys: ['QUESTION_TIMEOUT_MS'] });
  });

  it('should take a new secret without ever showing the saved one, and clear it', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'discord');
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
    const { connection } = openSettings(SETTINGS, 'advanced');

    await user.click(within(field('Provider')).getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'none' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    act(() => connection.emitEvent({ type: 'settings', settings: withSetting('STT_PROVIDER', { source: 'saved', value: 'none' }) }));

    expect(screen.getByText('Restart the server to apply Provider.')).toBeInTheDocument();
  });

  it('should test the Discord token typed in the form with the server of the form, before saving', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'discord');
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
    const { connection } = openSettings(SETTINGS, 'discord');

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
    const { connection } = openSettings(SETTINGS.filter(view => view.key !== 'DISCORD_GUILD_ID'), 'discord');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.discord.test' });
  });

  it('should show a setting and a section this page does not know by their keys', () => {
    openSettings([{ key: 'NEW_SETTING', group: 'future', apply: 'live', envOnly: false, source: 'default', kind: 'text', value: '', defaultValue: '' }], 'advanced');

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
