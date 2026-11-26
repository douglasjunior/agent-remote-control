import { StubRuntimeSettings } from '../testing/stub-runtime-settings.js';

import { GetSettingsUseCase } from './get-settings.use-case.js';


describe('GetSettingsUseCase', () => {
  it('should show every setting in the catalog order with its value, source, default, environment variable and how it applies', () => {
    const views = new GetSettingsUseCase(new StubRuntimeSettings({ QUESTION_TIMEOUT_MS: 0, SHELL_COMMAND_ENABLED: true })).execute();

    expect(views.map(view => view.key).slice(0, 3)).toEqual(['DISCORD_ENABLED', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']);
    expect(views).toContainEqual({ key: 'QUESTION_TIMEOUT_MS', group: 'general', apply: 'live', env: 'QUESTION_TIMEOUT_MS', envOnly: false, source: 'saved', kind: 'integer', value: 0, defaultValue: 300_000 });
    expect(views).toContainEqual({ key: 'SHELL_COMMAND_ENABLED', group: 'shell', apply: 'live', env: 'SHELL_COMMAND_ENABLED', envOnly: true, source: 'saved', kind: 'boolean', value: true, defaultValue: false });
    expect(views).toContainEqual({ key: 'REMOTE_URL', group: 'remote', apply: 'live', env: 'REMOTE_URL', envOnly: true, source: 'default', kind: 'text', value: '', defaultValue: '' });
    expect(views).toContainEqual({
      key: 'STT_PROVIDER',
      group: 'speech',
      apply: 'restart',
      env: 'STT_PROVIDER',
      envOnly: false,
      source: 'default',
      kind: 'choice',
      value: 'whisper-cpp',
      defaultValue: 'whisper-cpp',
      options: ['whisper-cpp', 'none'],
    });
  });

  it('should tell only whether a secret holds a value, never the value', () => {
    const settings = new StubRuntimeSettings();
    const useCase = new GetSettingsUseCase(settings);
    const token = () => useCase.execute().find(view => view.key === 'DISCORD_BOT_TOKEN');

    expect(token()).toEqual({ key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', env: 'DISCORD_BOT_TOKEN', envOnly: false, source: 'default', kind: 'secret', value: { set: false } });
    settings.set('DISCORD_BOT_TOKEN', 'secret-token');
    expect(token()).toEqual({ key: 'DISCORD_BOT_TOKEN', group: 'discord', apply: 'live', env: 'DISCORD_BOT_TOKEN', envOnly: false, source: 'saved', kind: 'secret', value: { set: true } });
    expect(JSON.stringify(useCase.execute())).not.toContain('secret-token');
  });
});
