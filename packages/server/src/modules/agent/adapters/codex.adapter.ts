import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentQuota, AgentQuotaBucket } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import {
  AbstractAcpAdapter,
  type SessionConfigPreset,
} from './abstract-acp.adapter.js';


const CODEX_ACP_ENTRY = '@agentclientprotocol/codex-acp/dist/index.js';

/**
 * The bridge applies approval and sandbox from the session mode on every turn, so they are set
 * through the mode rather than the Codex config. Full access never asks for approval, which nobody
 * answers in a remote session, and lets builds and tests write outside the sandbox.
 */
const SESSION_PRESETS: readonly SessionConfigPreset[] = [{ category: 'mode', value: 'agent-full-access' }];

/**
 * Tokens Codex keeps in context for the skill listing. The default, 2% of the context window,
 * shortens and then drops skill descriptions; 10 thousand is the highest value Codex accepts.
 */
const SKILL_LISTING_TOKEN_BUDGET = 10_000;

const QUOTA_TIMEOUT_MS = 10_000;

const RATE_LIMIT_WINDOW_KEYS = ['primary', 'secondary'] as const;

type RawWindow = {
  readonly usedPercent?: unknown;
  readonly windowDurationMins?: unknown;
  readonly resetsAt?: unknown;
};

@Injectable()
export class CodexAdapter extends AbstractAcpAdapter {
  readonly agentName = 'codex';

  constructor(
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  /**
   * Asks `codex app-server`, the JSON-RPC server behind the Codex TUI, for the account rate limits:
   * `initialize`, the `initialized` notification and then `account/rateLimits/read`.
   */
  override async getQuota(): Promise<AgentQuota | undefined> {
    let server: ChildProcess | undefined;
    try {
      const cwd = tmpdir();
      const env = this.buildAgentEnv(cwd);
      const codexPath = env.CODEX_PATH ?? this.fileSystem.resolveInPath('codex');
      if (!codexPath) {
        return undefined;
      }
      server = this.processRunner.spawn(codexPath, ['app-server'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      return this.parseRateLimits(await this.readRateLimits(server));
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    } finally {
      server?.kill();
    }
  }

  /**
   * Converts the `result` of the `account/rateLimits/read` request (`{ rateLimits: { primary, secondary } }`).
   * Returns `undefined` when the account reports no rate-limit window, which is the case for API-key logins.
   */
  private parseRateLimits(result: unknown): AgentQuota | undefined {
    const rateLimits = this.asObject(this.asObject(result)?.rateLimits);
    if (!rateLimits) return undefined;
    const buckets = RATE_LIMIT_WINDOW_KEYS
      .map(key => this.parseRateLimitWindow(key, rateLimits[key]))
      .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
    return buckets.length > 0 ? { groups: [{ name: 'Codex', buckets }] } : undefined;
  }

  private parseRateLimitWindow(key: string, raw: unknown): AgentQuotaBucket | undefined {
    const window = this.asObject(raw) as RawWindow | undefined;
    if (!window || typeof window.usedPercent !== 'number') return undefined;
    const label = this.formatWindow(window.windowDurationMins);
    return {
      id: key,
      name: label ? `${label} limit` : `${key} limit`,
      window: label ?? key,
      remainingFraction: Math.min(1, Math.max(0, 1 - window.usedPercent / 100)),
      resetTime:
        typeof window.resetsAt === 'number'
          ? new Date(window.resetsAt * 1000).toISOString()
          : undefined,
    };
  }

  private formatWindow(minutes: unknown): string | undefined {
    if (typeof minutes !== 'number' || !(minutes > 0)) return undefined;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readRateLimits(server: ChildProcess): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('app-server timed out')),
        QUOTA_TIMEOUT_MS,
      );
      const finish = (settle: () => void): void => {
        clearTimeout(timer);
        settle();
      };
      const send = (message: object): void => {
        server.stdin?.write(`${JSON.stringify(message)}\n`);
      };
      let buffer = '';
      server.once('error', error => finish(() => reject(error)));
      server.once('exit', () => finish(() => reject(new Error('app-server exited'))));
      server.stdout?.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          const message = this.parseRpcLine(line);
          if (message?.id === 1) {
            send({ method: 'initialized' });
            send({ id: 2, method: 'account/rateLimits/read' });
          } else if (message?.id === 2) {
            finish(() => (message.error
              ? reject(new Error(JSON.stringify(message.error)))
              : resolve(message.result)));
          }
        }
      });
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'agent-remote-control', version: '1.0.0' } },
      });
    });
  }

  private parseRpcLine(line: string): { id?: unknown; result?: unknown; error?: unknown } | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn(process.execPath, [this.resolveBridgeEntry()], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildCodexEnv(cwd),
    });
  }

  protected override sessionConfigPresets(): readonly SessionConfigPreset[] {
    return SESSION_PRESETS;
  }

  private resolveBridgeEntry(): string {
    return createRequire(import.meta.url).resolve(CODEX_ACP_ENTRY);
  }

  /**
   * The bridge ignores command-line arguments and reads its options from the environment. Without
   * `CODEX_PATH` it runs the Codex binary bundled as a dependency, which may not match the host
   * architecture or libc, so the user's `codex` from `PATH` takes its place.
   */
  private buildCodexEnv(cwd: string): NodeJS.ProcessEnv {
    const env = this.buildAgentEnv(cwd);
    env.CODEX_CONFIG = JSON.stringify({
      'skills.max_context_tokens': SKILL_LISTING_TOKEN_BUDGET,
      ...this.parseUserConfig(env.CODEX_CONFIG),
    });
    const codexPath = env.CODEX_PATH ?? this.fileSystem.resolveInPath('codex');
    if (codexPath) {
      env.CODEX_PATH = codexPath;
    }
    return env;
  }

  private parseUserConfig(config: string | undefined): Record<string, unknown> {
    if (!config) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    this.logger.warn('codex_config_ignored: CODEX_CONFIG is not a JSON object');
    return {};
  }
}
