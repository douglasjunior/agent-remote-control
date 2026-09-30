import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { AgentConfig } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AbstractAcpAdapter } from './abstract-acp.adapter.js';


@Injectable()
export class AntigravityAdapter extends AbstractAcpAdapter {
  readonly agentName = 'agy';

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
    const cwd = tmpdir();
    return this.processRunner.spawn(process.execPath, [bridgeBin], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildAgentEnv(cwd),
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
}
