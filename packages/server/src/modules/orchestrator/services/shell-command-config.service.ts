import { Inject, Injectable } from '@nestjs/common';

import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';


@Injectable()
export class ShellCommandConfigService {
  constructor(@Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort) {}

  isEnabled(): boolean {
    return this.settings.get('SHELL_COMMAND_ENABLED');
  }

  getTimeoutMs(): number {
    return this.settings.get('SHELL_COMMAND_TIMEOUT_MS');
  }

  getMaxOutputChars(): number {
    return this.settings.get('SHELL_COMMAND_MAX_OUTPUT_CHARS');
  }
}
