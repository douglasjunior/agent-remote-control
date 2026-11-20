import { Logger } from '@nestjs/common';

import { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { createWebSettings } from '../testing/web-settings.fixture.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


describe('WebSettingsService', () => {
  let configuration: StubAgentConfigurationPort;
  let observer: FakeClientConnection;
  let settings: ReturnType<typeof createWebSettings>;
  const view = (key: string) => settings.service.settings().then(event => event.settings.find(setting => setting.key === key));

  beforeEach(() => {
    rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    configuration = new StubAgentConfigurationPort();
    configuration.language = undefined;
    const registry = new WebConnectionRegistryService();
    observer = new FakeClientConnection('observer');
    registry.register(observer);
    settings = createWebSettings(configuration, registry);
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should show the user language first, then every runtime setting', async () => {
    const event = await settings.service.settings();

    expect(event.type).toBe('settings');
    expect(event.settings[0]).toEqual({ key: 'USER_LANGUAGE', group: 'general', apply: 'live', envOnly: false, source: 'default', kind: 'text', value: 'English', defaultValue: 'English' });
    expect(event.settings[1]?.key).toBe('DISCORD_ENABLED');
    configuration.language = 'Spanish';
    expect(await view('USER_LANGUAGE')).toMatchObject({ source: 'saved', value: 'Spanish' });
  });

  it('should save the language and the settings, and show the change to every connection', async () => {
    await expect(settings.service.set({ USER_LANGUAGE: '  Brazilian  Portuguese ', QUESTION_TIMEOUT_MS: 0 })).resolves.toEqual({ ok: true });

    expect(configuration.language).toBe('Brazilian Portuguese');
    expect(settings.store.saved).toEqual({ QUESTION_TIMEOUT_MS: 0 });
    expect(observer.sent).toEqual([await settings.service.settings()]);
    expect(await view('QUESTION_TIMEOUT_MS')).toMatchObject({ source: 'saved', value: 0 });
  });

  it('should save nothing when the language or another value is refused', async () => {
    await expect(settings.service.set({ USER_LANGUAGE: '<b>', QUESTION_TIMEOUT_MS: 0 })).resolves.toEqual({ ok: false, error: 'USER_LANGUAGE: Leave out < > [ ] and backticks' });
    await expect(settings.service.set({ USER_LANGUAGE: 'Spanish', QUESTION_TIMEOUT_MS: -1 })).resolves.toEqual({ ok: false, error: 'QUESTION_TIMEOUT_MS: Use 0 or more' });

    expect(configuration.language).toBeUndefined();
    expect(settings.store.saved).toEqual({});
    expect(observer.sent).toEqual([]);
  });

  it('should reset the language and the settings, and refuse an unknown key', async () => {
    configuration.language = 'Spanish';
    await settings.service.set({ LOG_RETENTION_DAYS: 7 });

    await expect(settings.service.reset(['USER_LANGUAGE', 'LOG_RETENTION_DAYS'])).resolves.toEqual({ ok: true });
    await expect(settings.service.reset(['PORT'])).resolves.toEqual({ ok: false, error: 'Unknown setting: PORT' });

    expect(configuration.language).toBeUndefined();
    expect(settings.store.saved).toEqual({});
    expect(observer.sent).toHaveLength(2);
  });

  it('should reset the settings alone, keeping the language', async () => {
    configuration.language = 'Spanish';

    await settings.service.reset(['LOG_RETENTION_DAYS']);

    expect(configuration.language).toBe('Spanish');
  });

  it('should answer a Discord test with its result', async () => {
    settings.tester.result = { ok: true, botName: 'arc-bot', guildName: 'Home' };

    await expect(settings.service.testDiscord({ token: 'typed', guildId: '12345678901234567' })).resolves.toEqual({
      type: 'settings.discord.test.result',
      ok: true,
      botName: 'arc-bot',
      guildName: 'Home',
    });
    expect(settings.tester.tests).toEqual([{ token: 'typed', guildId: '12345678901234567' }]);
  });
});
