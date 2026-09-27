import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { AgentConfig } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AbstractAcpAdapter } from './abstract-acp.adapter.js';


const HOST_ONLY_ENV_VARS = new Set([
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'WORKSPACE_DIR',
  'DATA_DIR',
  'SESSION_IDLE_TIMEOUT_MS',
  'PORT',
  'PWD',
  'OLDPWD',
  'INIT_CWD',
  'PROJECT_CWD',
]);

const HOST_ONLY_ENV_PREFIX = 'npm_';

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
      env: this.buildBridgeEnv(cwd),
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

  private buildBridgeEnv(cwd: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (this.isHostOnlyVariable(key)) {
        continue;
      }
      env[key] = value;
    }

    env.PWD = cwd;

    if (!env.AGY_PATH) {
      const agyPath = this.fileSystem.resolveInPath('agy');
      if (agyPath) {
        env.AGY_PATH = agyPath;
      }
    }

    return env;
  }

  private isHostOnlyVariable(key: string): boolean {
    return HOST_ONLY_ENV_VARS.has(key) || key.startsWith(HOST_ONLY_ENV_PREFIX);
  }
}
