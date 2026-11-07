import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { AgentConfig } from '../ports/agent.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AbstractAcpAdapter } from './abstract-acp.adapter.js';


@Injectable()
export class OpenCodeAdapter extends AbstractAcpAdapter {
  readonly agentName = 'opencode';

  constructor(
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn('opencode', ['acp'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildAgentEnv(cwd),
    });
  }
}
