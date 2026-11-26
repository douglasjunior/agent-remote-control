import type { SettingView } from '@agent-remote-control/protocol/settings';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { renderApp } from '../../test/render-app.js';
import { stubWideHub } from '../../test/wide-hub.js';


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

function openSettings(settings = SETTINGS, section = 'general') {
  const app = renderApp(`/settings/${section}`);
  act(() => app.connection.emitEvent({ type: 'settings', settings }));
  return app;
}

const sectionLink = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) });
const openSection = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(sectionLink(name));
const field = (label: string) => screen.getByRole('group', { name: label });
const lastSent = (connection: ReturnType<typeof renderApp>['connection']) => connection.sent.at(-1);
/** The server's answer to the last change: the settings, broadcast to every page, then the result for the requester. */
const answerChange = (connection: ReturnType<typeof renderApp>['connection'], settings: SettingView[]) => act(() => {
  const { requestId } = lastSent(connection) as { requestId: string };
  connection.emitEvent({ type: 'settings', settings });
  connection.emitEvent({ type: 'settings.result', requestId, ok: true });
});

stubWideHub();

afterEach(() => {
  act(() => toast.dismiss());
});

describe('ServerSettingsSection', () => {
  it('should ask for the settings once connected and show them by section and group, with where each value comes from', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp('/settings/general');

    expect(connection.sent).toContainEqual({ type: 'settings.get' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings…');
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));

    expect(screen.getByRole('heading', { name: 'General', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent)).toEqual(['General']);
    expect(within(field('Language')).getByText('Default')).toBeInTheDocument();
    expect(within(field('Language')).queryByText('USER_LANGUAGE')).not.toBeInTheDocument();

    await openSection(user, 'Discord');
    expect(within(field('Server ID')).getByText('Environment')).toBeInTheDocument();
    expect(within(field('Server ID')).getByText('DISCORD_GUILD_ID')).toBeInTheDocument();

    await openSection(user, 'Advanced');
    expect(screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent)).toEqual(['Sessions and logs', 'Speech-to-text']);
    expect(within(field('Question timeout')).getByText('Saved')).toBeInTheDocument();
    expect(within(field('Question timeout')).getByRole('textbox')).toHaveValue('5');
    expect(within(field('Question timeout')).getByText('minutes')).toBeInTheDocument();
    expect(within(field('Log retention')).getByText('days')).toBeInTheDocument();
    expect(within(field('Provider')).getByText('Applies when the server restarts.')).toBeInTheDocument();
  });

  it('should keep the changes of every section, mark the sections that hold one and tell an invalid value apart', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();

    await openSection(user, 'Discord');
    await user.click(within(field('Discord bot')).getByRole('switch'));
    await openSection(user, 'Advanced');
    await user.type(within(field('Question timeout')).getByRole('textbox'), 'x');
    await user.type(within(field('Log retention')).getByRole('textbox'), '2');

    expect(sectionLink('Discord')).toHaveAccessibleName('Discord (has unsaved changes)');
    expect(sectionLink('Advanced')).toHaveAccessibleName('Advanced (has an invalid value)');
    expect(sectionLink('General')).toHaveAccessibleName('General');
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.type(within(field('Question timeout')).getByRole('textbox'), '{Backspace}');
    await openSection(user, 'Discord');
    expect(within(field('Discord bot')).getByText('Unsaved')).toBeInTheDocument();
    expect(sectionLink('Advanced')).toHaveAccessibleName('Advanced (has unsaved changes)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { DISCORD_ENABLED: false, LOG_RETENTION_DAYS: 142 } });
    answerChange(connection, withSetting('LOG_RETENTION_DAYS', { source: 'saved', value: 142 }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(sectionLink('Discord')).toHaveAccessibleName('Discord');
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
    await openSection(user, 'Discord');
    await user.click(within(field('Discord bot')).getByRole('switch'));
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(within(field('Discord bot')).getByText('Unsaved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { DISCORD_ENABLED: false, QUESTION_TIMEOUT_MS: 0 } });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    answerChange(connection, withSetting('QUESTION_TIMEOUT_MS', { value: 0 }));

    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    await openSection(user, 'Advanced');
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

    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { QUESTION_TIMEOUT_MS: 90_000 } });
    answerChange(connection, withSetting('QUESTION_TIMEOUT_MS', { value: 90_000 }));
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

    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { AGENT_AUTH_STATUS_TIMEOUT_MS: 2_500 } });
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

    await openSection(user, 'Agents');
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

    const { requestId } = lastSent(connection) as { requestId: string };
    act(() => connection.emitEvent({ type: 'error', message: 'Another squad is named "Fast"' }));
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));
    act(() => connection.emitEvent({ type: 'settings.result', requestId: 'another-page', ok: true }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();

    act(() => connection.emitEvent({ type: 'settings.result', requestId, ok: false, error: 'USER_LANGUAGE: Leave out < > [ ] and backticks' }));

    expect(screen.getByRole('alert')).toHaveTextContent('USER_LANGUAGE: Leave out < > [ ] and backticks');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();
  });

  it('should keep the changes and say the save is unconfirmed when the connection closes before the answer', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings();
    await user.clear(within(field('Language')).getByRole('textbox'));
    await user.type(within(field('Language')).getByRole('textbox'), 'Spanish');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    act(() => connection.emitStatus('connecting'));
    act(() => connection.emitStatus('open'));
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));

    expect(screen.getByRole('alert')).toHaveTextContent('The connection closed before the server confirmed the change.');
    expect(within(field('Language')).getByRole('textbox')).toHaveValue('Spanish');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
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

    expect(lastSent(connection)).toEqual({ type: 'settings.reset', requestId: expect.any(String), keys: ['QUESTION_TIMEOUT_MS'] });
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
    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { DISCORD_BOT_TOKEN: 'new-token' } });
    answerChange(connection, withSetting('DISCORD_BOT_TOKEN', { source: 'saved', value: { set: true } }));

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

    expect(lastSent(connection)).toEqual({ type: 'settings.set', requestId: expect.any(String), changes: { DISCORD_BOT_TOKEN: '' } });
  });

  it('should tell to restart the server once a setting that applies on restart is saved', async () => {
    const user = userEvent.setup();
    const { connection } = openSettings(SETTINGS, 'advanced');

    await user.click(within(field('Provider')).getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'none' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    answerChange(connection, withSetting('STT_PROVIDER', { source: 'saved', value: 'none' }));

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
});
