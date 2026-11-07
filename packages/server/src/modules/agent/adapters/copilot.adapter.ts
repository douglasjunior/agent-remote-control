import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentQuota, AgentQuotaBucket } from '../ports/agent.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import {
  AbstractAcpAdapter,
  type SessionConfigPreset,
} from './abstract-acp.adapter.js';


/**
 * Copilot publishes tool autonomy as a session option. With it on, tools run directly instead
 * of raising a `session/request_permission` per call, which nobody answers in a remote session.
 */
const SESSION_PRESETS: readonly SessionConfigPreset[] = [{ category: 'permissions', value: 'on' }];

/**
 * Characters Copilot keeps in context for the skill listing (`SKILL_CHAR_BUDGET`). With the default
 * of 15 thousand, skills that do not fit are listed by name only, without the description that
 * tells the agent when to use them.
 */
const SKILL_LISTING_CHAR_BUDGET = '100000';

type RawSnapshot = {
  readonly quota_id?: unknown;
  readonly percent_remaining?: unknown;
  readonly remaining?: unknown;
  readonly entitlement?: unknown;
  readonly unlimited?: unknown;
};

const QUOTA_NAMES: Readonly<Record<string, string>> = {
  premium_interactions: 'Premium Requests Remaining',
};

@Injectable()
export class CopilotAdapter extends AbstractAcpAdapter {
  readonly agentName = 'copilot';

  constructor(
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  override async getQuota(): Promise<AgentQuota | undefined> {
    try {
      const { exitCode, output } = await this.processRunner.run('gh', [
        'api',
        '/copilot_internal/user',
      ]);
      return exitCode === 0 ? this.parseUserOutput(output) : undefined;
    } catch (error) {
      this.logger.debug(
        `quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Parses the output of `gh api /copilot_internal/user`. Unlimited snapshots are skipped; returns `undefined`
   * when the payload has no `quota_snapshots`.
   */
  private parseUserOutput(output: string): AgentQuota | undefined {
    let parsed: {
      copilot_plan?: unknown;
      quota_reset_date_utc?: unknown;
      quota_snapshots?: unknown;
    };
    try {
      parsed = JSON.parse(output);
    } catch {
      return undefined;
    }
    const snapshots = parsed?.quota_snapshots;
    if (!snapshots || typeof snapshots !== 'object') {
      return undefined;
    }
    const resetTime =
      typeof parsed.quota_reset_date_utc === 'string'
        ? parsed.quota_reset_date_utc
        : undefined;
    const buckets = Object.entries(snapshots as Record<string, RawSnapshot>)
      .map(([key, raw]) => this.parseSnapshot(key, raw ?? {}, resetTime))
      .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
    const plan = typeof parsed.copilot_plan === 'string' ? parsed.copilot_plan : undefined;
    return {
      groups: [
        {
          name: 'GitHub Copilot',
          description: plan ? `Plan: ${plan}` : undefined,
          buckets,
        },
      ],
    };
  }

  private parseSnapshot(
    key: string,
    raw: RawSnapshot,
    resetTime: string | undefined,
  ): AgentQuotaBucket | undefined {
    if (raw.unlimited === true || typeof raw.percent_remaining !== 'number') {
      return undefined;
    }
    const id = typeof raw.quota_id === 'string' ? raw.quota_id : key;
    const hasCounts =
      typeof raw.remaining === 'number' && typeof raw.entitlement === 'number';
    return {
      id,
      name: QUOTA_NAMES[id] ?? this.humanize(id),
      window: 'monthly',
      remainingFraction: raw.percent_remaining / 100,
      resetTime,
      description: hasCounts
        ? `${String(raw.remaining)} of ${String(raw.entitlement)} remaining`
        : undefined,
    };
  }

  private humanize(quotaId: string): string {
    return `${quotaId
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')} Remaining`;
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn('copilot', ['--acp', '--stdio'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { SKILL_CHAR_BUDGET: SKILL_LISTING_CHAR_BUDGET, ...this.buildAgentEnv(cwd) },
    });
  }

  protected override sessionConfigPresets(): readonly SessionConfigPreset[] {
    return SESSION_PRESETS;
  }
}
