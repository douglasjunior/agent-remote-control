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


const CLAUDE_AGENT_ACP_ENTRY = '@agentclientprotocol/claude-agent-acp/dist/index.js';

const USAGE_LIMIT_LINE = /^(.+?):\s*(\d+(?:\.\d+)?)%\s+used(?:\s*·\s*resets\s+(.+?))?\s*$/;
const USAGE_RESET_TIME = /^(?:([A-Z][a-z]{2})\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

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
      return exitCode === 0 ? this.parseUsageOutput(output) : undefined;
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Parses the stdout of `claude -p /usage`: one `<label>: <N>% used · resets <time> (<zone>)` line per limit.
   * Other lines are ignored; returns `undefined` when no limit line is found.
   */
  private parseUsageOutput(output: string): AgentQuota | undefined {
    const now = new Date();
    const buckets: AgentQuotaBucket[] = [];
    for (const line of output.split('\n')) {
      const match = USAGE_LIMIT_LINE.exec(line.trim());
      if (!match) continue;
      const [, label, percent, reset] = match;
      buckets.push({
        id: this.slug(label!),
        name: label!,
        window: this.windowOf(label!),
        remainingFraction: Math.max(0, 1 - Number(percent) / 100),
        resetTime: reset ? this.parseResetTime(reset, now) : undefined,
      });
    }
    return buckets.length > 0
      ? { groups: [{ name: 'Claude Code', buckets }] }
      : undefined;
  }

  private windowOf(label: string): string {
    if (/session/i.test(label)) return '5h';
    if (/week/i.test(label)) return '7d';
    return 'limit';
  }

  private slug(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * `/usage` prints resets as `Oct 30, 11:29pm (America/Sao_Paulo)`, or just `11:29pm (America/Sao_Paulo)` for the
   * current day, always without a year. Resolves to the first matching instant that is not in the past.
   */
  private parseResetTime(text: string, now: Date): string | undefined {
    const match = USAGE_RESET_TIME.exec(text.trim());
    if (!match) return undefined;
    const [, monthName, dayText, hourText, minuteText, meridiem, timeZone] = match;
    let hour = Number(hourText) % 12;
    if (meridiem?.toLowerCase() === 'pm') hour += 12;
    const minute = Number(minuteText ?? 0);
    try {
      const today = new Date(now.getTime() + this.zoneOffset(now.getTime(), timeZone!));
      let month = today.getUTCMonth();
      let day = today.getUTCDate();
      const year = today.getUTCFullYear();
      const dated = monthName !== undefined;
      if (dated) {
        month = MONTHS.indexOf(monthName.toLowerCase());
        day = Number(dayText);
        if (month < 0) return undefined;
      }
      let instant = this.wallClockToInstant(year, month, day, hour, minute, timeZone!);
      if (instant < now.getTime()) {
        instant = dated
          ? this.wallClockToInstant(year + 1, month, day, hour, minute, timeZone!)
          : instant + DAY_MS;
      }
      return new Date(instant).toISOString();
    } catch {
      return undefined;
    }
  }

  /** Offset in ms of `timeZone` from UTC at the given instant. */
  private zoneOffset(instant: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const value = (type: string): number =>
      Number(parts.find(part => part.type === type)?.value);
    const wallClock = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    return wallClock - Math.floor(instant / 1000) * 1000;
  }

  private wallClockToInstant(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timeZone: string,
  ): number {
    const naive = Date.UTC(year, month, day, hour, minute);
    const first = naive - this.zoneOffset(naive, timeZone);
    return naive - this.zoneOffset(first, timeZone);
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
