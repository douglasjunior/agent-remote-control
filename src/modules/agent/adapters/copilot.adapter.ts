import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentQuota } from '../ports/agent.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';
import { parseCopilotUserOutput } from '../utils/copilot-usage.util.js';

import {
  AbstractAcpAdapter,
  type SessionConfigPreset,
} from './abstract-acp.adapter.js';


/**
 * Copilot publishes tool autonomy as a session option. With it on, tools run directly instead
 * of raising a `session/request_permission` per call, which nobody answers in a remote session.
 */
const SESSION_PRESETS: readonly SessionConfigPreset[] = [{ category: 'permissions', value: 'on' }];

@Injectable()
export class CopilotAdapter extends AbstractAcpAdapter {
  readonly agentName = 'copilot';

  constructor(
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  override async getQuota(): Promise<AgentQuota | undefined> {
    try {
      const { exitCode, output } = await this.processRunner.run('gh', [
        'api',
        '/copilot_internal/user',
      ]);
      return exitCode === 0 ? parseCopilotUserOutput(output) : undefined;
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn('copilot', ['--acp', '--stdio'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildAgentEnv(cwd),
    });
  }

  protected override sessionConfigPresets(): readonly SessionConfigPreset[] {
    return SESSION_PRESETS;
  }
}
