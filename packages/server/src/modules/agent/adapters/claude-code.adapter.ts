import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentQuota } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';
import { parseClaudeUsageOutput } from '../utils/claude-usage.util.js';

import {
  AbstractAcpAdapter,
  type SessionConfigPreset,
} from './abstract-acp.adapter.js';


const CLAUDE_AGENT_ACP_ENTRY = '@agentclientprotocol/claude-agent-acp/dist/index.js';

/**
 * Characters Claude Code keeps in context for the skill listing (`SLASH_COMMAND_TOOL_CHAR_BUDGET`).
 * The default, 1% of the context window, trims or drops skill descriptions once a project has a few
 * dozen skills, and the agent stops finding the right one.
 */
const SKILL_LISTING_CHAR_BUDGET = '100000';

/**
 * Sessions of the remote-controlled agent have no one to answer permission prompts, so they
 * run with `bypassPermissions`, the same full-access behavior of the agy bridge.
 */
const SESSION_PRESETS: readonly SessionConfigPreset[] = [{ category: 'mode', value: 'bypassPermissions' }];

@Injectable()
export class ClaudeCodeAdapter extends AbstractAcpAdapter {
  readonly agentName = 'claude';

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
      const { exitCode, output } = await this.processRunner.run('claude', ['-p', '/usage']);
      return exitCode === 0 ? parseClaudeUsageOutput(output) : undefined;
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn(process.execPath, [this.resolveAgentEntry()], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildClaudeEnv(cwd),
    });
  }

  protected override sessionConfigPresets(): readonly SessionConfigPreset[] {
    return SESSION_PRESETS;
  }

  private resolveAgentEntry(): string {
    return createRequire(import.meta.url).resolve(CLAUDE_AGENT_ACP_ENTRY);
  }

  /**
   * `CLAUDE_CODE_EXECUTABLE` is how the Claude Agent SDK runs the user's `claude` from `PATH`
   * instead of the binary bundled with the SDK.
   */
  private buildClaudeEnv(cwd: string): NodeJS.ProcessEnv {
    const env = this.buildAgentEnv(cwd);
    env.SLASH_COMMAND_TOOL_CHAR_BUDGET ??= SKILL_LISTING_CHAR_BUDGET;
    delete env.CLAUDE_CODE_EXECUTABLE;
    const claudePath = this.fileSystem.resolveInPath('claude');
    if (claudePath) {
      env.CLAUDE_CODE_EXECUTABLE = claudePath;
    }
    return env;
  }
}
