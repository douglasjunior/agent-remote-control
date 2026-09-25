import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { AbstractAcpAdapter } from './abstract-acp.adapter.js';
import type { AgentConfig } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

@Injectable()
export class AntigravityAdapter extends AbstractAcpAdapter {
  protected readonly agentName = 'agy';

  constructor(
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  protected spawnAgentProcess(): ChildProcess {
    const bridgeBin = this.resolveBridgeBin();
    return this.processRunner.spawn(process.execPath, [bridgeBin], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildBridgeEnv(),
    });
  }

  private resolveBridgeBin(): string {
    const distPath = fileURLToPath(
      new URL('../bridges/agy-acp-bridge.js', import.meta.url),
    );
    if (this.fileSystem.isReadableFile(distPath)) {
      return distPath;
    }
    const flatDistPath = fileURLToPath(
      new URL('./agy-acp-bridge.js', import.meta.url),
    );
    if (this.fileSystem.isReadableFile(flatDistPath)) {
      return flatDistPath;
    }
    return fileURLToPath(
      new URL('../bridges/agy-acp-bridge.ts', import.meta.url),
    );
  }

  private buildBridgeEnv(): NodeJS.ProcessEnv {
    if (process.env.AGY_PATH) {
      return process.env;
    }
    const agyPath = this.fileSystem.resolveInPath('agy');
    if (!agyPath) {
      return process.env;
    }
    return { ...process.env, AGY_PATH: agyPath };
  }
}
