import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentQuota } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';
import { parseCodexRateLimits } from '../utils/codex-usage.util.js';

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
      return parseCodexRateLimits(await this.readRateLimits(server));
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    } finally {
      server?.kill();
    }
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
