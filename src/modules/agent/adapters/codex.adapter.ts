import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

import type { AgentConfig } from '../ports/agent.port.js';
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
