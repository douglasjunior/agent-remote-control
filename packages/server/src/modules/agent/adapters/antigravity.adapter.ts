import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type {
  AgentConfig,
  AgentQuota,
  AgentQuotaBucket,
  AgentQuotaGroup,
} from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AbstractAcpAdapter } from './abstract-acp.adapter.js';


type RawBucket = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly window?: unknown;
  readonly remaining_fraction?: unknown;
  readonly reset_time?: unknown;
};

type RawGroup = {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly buckets?: unknown;
};

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

  override async getQuota(): Promise<AgentQuota | undefined> {
    try {
      const { exitCode, output } = await this.processRunner.run('agy', [
        '--output-format',
        'json',
        '--print',
        '/usage',
      ]);
      return exitCode === 0 ? this.parseUsageOutput(output) : undefined;
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Parses the stdout of `agy --output-format json --print /usage`. Tolerates log noise around the JSON
   * document; returns `undefined` when the payload is not a successful `usage` command result.
   */
  private parseUsageOutput(output: string): AgentQuota | undefined {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start < 0 || end < start) {
      return undefined;
    }
    let parsed: {
      status?: unknown;
      command?: { name?: unknown; data?: { description?: unknown; groups?: unknown } };
    };
    try {
      parsed = JSON.parse(output.slice(start, end + 1));
    } catch {
      return undefined;
    }
    const data = parsed.command?.data;
    if (
      parsed.status !== 'SUCCESS'
      || parsed.command?.name !== 'usage'
      || !data
      || !Array.isArray(data.groups)
    ) {
      return undefined;
    }
    const groups = (data.groups as RawGroup[])
      .map(group => this.parseQuotaGroup(group))
      .filter((group): group is AgentQuotaGroup => group !== undefined);
    return { description: this.asString(data.description), groups };
  }

  private parseQuotaGroup(raw: RawGroup): AgentQuotaGroup | undefined {
    const name = this.asString(raw.name);
    if (!name || !Array.isArray(raw.buckets)) {
      return undefined;
    }
    const buckets = (raw.buckets as RawBucket[])
      .map(bucket => this.parseQuotaBucket(bucket))
      .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
    return { name, description: this.asString(raw.description), buckets };
  }

  private parseQuotaBucket(raw: RawBucket): AgentQuotaBucket | undefined {
    const id = this.asString(raw.id);
    const name = this.asString(raw.name);
    const window = this.asString(raw.window);
    if (!id || !name || !window || typeof raw.remaining_fraction !== 'number') {
      return undefined;
    }
    return {
      id,
      name,
      window,
      remainingFraction: raw.remaining_fraction,
      resetTime: this.asString(raw.reset_time),
      description: this.asString(raw.description),
    };
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
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
