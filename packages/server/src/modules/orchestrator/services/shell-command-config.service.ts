import { Injectable } from '@nestjs/common';


const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

@Injectable()
export class ShellCommandConfigService {
  isEnabled(): boolean {
    return process.env.SHELL_COMMAND_ENABLED?.trim().toLowerCase() === 'true';
  }

  getTimeoutMs(): number {
    return Number(process.env.SHELL_COMMAND_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  }

  getMaxOutputChars(): number {
    return Number(process.env.SHELL_COMMAND_MAX_OUTPUT_CHARS) || DEFAULT_MAX_OUTPUT_CHARS;
  }
}
