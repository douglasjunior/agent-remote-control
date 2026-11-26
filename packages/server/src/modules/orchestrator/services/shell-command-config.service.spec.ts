import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { ShellCommandConfigService } from './shell-command-config.service.js';


describe('ShellCommandConfigService', () => {
  it('should be disabled by default and use the default limits', () => {
    const config = new ShellCommandConfigService(new StubRuntimeSettings());

    expect(config.isEnabled()).toBe(false);
    expect(config.getTimeoutMs()).toBe(60_000);
    expect(config.getMaxOutputChars()).toBe(8_000);
  });

  it('should read the flag and the limits from the settings', () => {
    const config = new ShellCommandConfigService(new StubRuntimeSettings({
      SHELL_COMMAND_ENABLED: true,
      SHELL_COMMAND_TIMEOUT_MS: 1_000,
      SHELL_COMMAND_MAX_OUTPUT_CHARS: 50,
    }));

    expect(config.isEnabled()).toBe(true);
    expect(config.getTimeoutMs()).toBe(1_000);
    expect(config.getMaxOutputChars()).toBe(50);
  });
});
