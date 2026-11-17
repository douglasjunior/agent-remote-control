import { describe, expect, it } from '@rstest/core';

import { ShellCommandDisabledError } from './shell-command-disabled.error.js';


describe('ShellCommandDisabledError', () => {
  it('should explain how to enable shell commands', () => {
    const error = new ShellCommandDisabledError();

    expect(error.name).toBe('ShellCommandDisabledError');
    expect(error.message).toContain('SHELL_COMMAND_ENABLED=true');
  });
});
