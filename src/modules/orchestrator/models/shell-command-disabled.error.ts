export class ShellCommandDisabledError extends Error {
  constructor() {
    super('Shell commands are disabled. Set SHELL_COMMAND_ENABLED=true to enable them.');
    this.name = 'ShellCommandDisabledError';
  }
}
