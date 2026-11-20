import { Logger } from '@nestjs/common';

import { RuntimeSettingsService } from './runtime-settings.service.js';


describe('RuntimeSettingsService', () => {
  let settings: RuntimeSettingsService;
  let warn: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    settings = new RuntimeSettingsService();
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rs.restoreAllMocks();
  });

  it('should take the default while nothing else gives a value', () => {
    rs.stubEnv('QUESTION_TIMEOUT_MS', undefined);

    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 300_000, source: 'default' });
  });

  it('should take the environment variable over the default, and the saved value over both', () => {
    rs.stubEnv('QUESTION_TIMEOUT_MS', ' 1500 ');
    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 1500, source: 'env' });

    settings.replaceSaved({ QUESTION_TIMEOUT_MS: 0 });

    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 0, source: 'saved' });
    expect(settings.get('QUESTION_TIMEOUT_MS')).toBe(0);
  });

  it('should read an empty variable as a value for a text or a secret, and as unset for any other kind', () => {
    rs.stubEnv('DISCORD_BOT_TOKEN', '');
    rs.stubEnv('REMOTE_URL', '');
    rs.stubEnv('QUESTION_TIMEOUT_MS', '  ');
    rs.stubEnv('SHELL_COMMAND_ENABLED', '');

    expect(settings.resolve('DISCORD_BOT_TOKEN')).toEqual({ value: '', source: 'env' });
    expect(settings.resolve('REMOTE_URL')).toEqual({ value: '', source: 'env' });
    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 300_000, source: 'default' });
    expect(settings.resolve('SHELL_COMMAND_ENABLED')).toEqual({ value: false, source: 'default' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['SHELL_COMMAND_ENABLED', ' TRUE ', true],
    ['AGENT_AUTH_ENABLED', 'false', false],
    ['STT_PROVIDER', ' None ', 'none'],
    ['STT_LANGUAGE', ' pt ', 'pt'],
    ['DISCORD_BOT_TOKEN', ' secret-token ', 'secret-token'],
  ] as const)('should read %s=%j from the environment as %j', (key, raw, value) => {
    rs.stubEnv(key, raw);

    expect(settings.resolve(key)).toEqual({ value, source: 'env' });
  });

  it.each([
    ['QUESTION_TIMEOUT_MS', 'abc'],
    ['QUESTION_TIMEOUT_MS', '-5'],
    ['QUESTION_TIMEOUT_MS', '1e3'],
    ['SESSION_IDLE_TIMEOUT_MS', '0'],
    ['SHELL_COMMAND_ENABLED', 'yes'],
    ['STT_PROVIDER', 'magic'],
    ['REMOTE_URL', 'http://arc.example.com'],
  ] as const)('should log %s=%j once and take the default', (key, raw) => {
    rs.stubEnv(key, raw);

    expect(settings.resolve(key).source).toBe('default');
    settings.get(key);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`setting_invalid: ${key}="${raw}" is not valid; using `));
  });

  it('should never log the value of a secret that does not parse', () => {
    rs.stubEnv('DISCORD_BOT_TOKEN', 'x'.repeat(201));

    expect(settings.resolve('DISCORD_BOT_TOKEN')).toEqual({ value: '', source: 'default' });
    expect(warn).toHaveBeenCalledWith('setting_invalid: DISCORD_BOT_TOKEN is not valid; using the default');
  });

  it('should ignore a saved value its schema no longer accepts, logging it once', () => {
    rs.stubEnv('QUESTION_TIMEOUT_MS', '1500');
    settings.replaceSaved({ QUESTION_TIMEOUT_MS: 'soon' });

    expect(settings.resolve('QUESTION_TIMEOUT_MS')).toEqual({ value: 1500, source: 'env' });
    settings.get('QUESTION_TIMEOUT_MS');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('setting_invalid: the saved QUESTION_TIMEOUT_MS is not valid; ignored');
  });
});
