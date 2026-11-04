import { Inject, Injectable, Logger } from '@nestjs/common';

import { IProcessRunnerPort } from '../../agent/ports/process-runner.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { ShellCommandDisabledError } from '../models/shell-command-disabled.error.js';
import type { ShellCommandResult } from '../models/shell-command-result.model.js';
import { ShellCommandConfigService } from '../services/shell-command-config.service.js';


@Injectable()
export class RunShellCommandUseCase {
  private readonly logger = new Logger(RunShellCommandUseCase.name);
  private readonly running = new Map<string, AbortController>();

  constructor(
    @Inject(IProcessRunnerPort) private readonly processRunner: IProcessRunnerPort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    private readonly config: ShellCommandConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.isEnabled();
  }

  async execute(conversationId: string, command: string): Promise<ShellCommandResult> {
    if (!this.config.isEnabled()) {
      throw new ShellCommandDisabledError();
    }

    this.logger.log(`[Shell Command] Conversation=${conversationId}`);
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(this.config.getTimeoutMs());
    this.running.set(conversationId, controller);

    try {
      const { exitCode, output } = await this.processRunner.run('sh', ['-c', command], {
        cwd: this.workspace.getBaseDirectory(),
        signal: AbortSignal.any([timeout, controller.signal]),
      });
      const maxChars = this.config.getMaxOutputChars();
      const truncated = output.length > maxChars;
      return {
        command,
        exitCode,
        output: truncated ? output.slice(-maxChars) : output,
        truncated,
        timedOut: timeout.aborted,
        cancelled: controller.signal.aborted,
      };
    } finally {
      this.running.delete(conversationId);
    }
  }

  cancel(conversationId: string): boolean {
    const controller = this.running.get(conversationId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }
}
