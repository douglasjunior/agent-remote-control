import { afterEach, describe, expect, it } from 'vitest';

import { ShellCommandConfigService } from './shell-command-config.service.js';


describe('ShellCommandConfigService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should be disabled by default and use the default limits', () => {
    delete process.env.SHELL_COMMAND_ENABLED;
    delete process.env.SHELL_COMMAND_TIMEOUT_MS;
    delete process.env.SHELL_COMMAND_MAX_OUTPUT_CHARS;
    const config = new ShellCommandConfigService();

    expect(config.isEnabled()).toBe(false);
    expect(config.getTimeoutMs()).toBe(60_000);
    expect(config.getMaxOutputChars()).toBe(8_000);
  });

  it('should be enabled only by the value true', () => {
    const config = new ShellCommandConfigService();

    process.env.SHELL_COMMAND_ENABLED = ' TRUE ';
    expect(config.isEnabled()).toBe(true);
    process.env.SHELL_COMMAND_ENABLED = '1';
    expect(config.isEnabled()).toBe(false);
  });

  it('should read the limits from the environment', () => {
    process.env.SHELL_COMMAND_TIMEOUT_MS = '1500';
    process.env.SHELL_COMMAND_MAX_OUTPUT_CHARS = '100';
    const config = new ShellCommandConfigService();

    expect(config.getTimeoutMs()).toBe(1500);
    expect(config.getMaxOutputChars()).toBe(100);
  });
});
