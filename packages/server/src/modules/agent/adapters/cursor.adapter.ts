import type { SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { z } from 'zod';

import type { AgentConfig, AgentModelInfo, AgentQuota, AgentQuotaBucket } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import {
  AbstractAcpAdapter,
  type AgentExtensionRequest,
} from './abstract-acp.adapter.js';


/** Older installations only ship `cursor-agent`; the generic `agent` comes last because it may belong to another tool. */
export const CURSOR_BINARIES = ['cursor-agent', 'agent'] as const;

/**
 * Global flags, so they come before the `acp` subcommand. A remote session has no one to answer
 * prompts: `--force` approves every tool call, `--trust` skips the workspace trust prompt, and
 * `--approve-mcps` the approval of the project's MCP servers. `--sandbox disabled` keeps the OS
 * sandbox from blocking the writes that the approved tool calls make.
 */
const CURSOR_ARGS = ['--force', '--sandbox', 'disabled', '--trust', '--approve-mcps', 'acp'];

const QUESTION_REDIRECT =
  'Nobody can answer interactive questions in this session. Write your question in your final response with the <question> tags your instructions describe, and end your turn.';

const PLAN_REDIRECT =
  'Plans are not approved interactively in this session. Carry out the task, or write the plan in your final response when the task asks for one.';

/** Cursor encodes the model parameters in its id, as in `claude-opus-5[thinking=true,effort=high,fast=false]`. */
const MODEL_PARAMS_PATTERN = /^[^[]+\[(?<params>.*)\]$/;

const EFFORT_PARAM_KEYS = ['effort', 'reasoning'];

const DEFAULT_API_ENDPOINT = 'https://api2.cursor.sh';
const USAGE_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const QUOTA_TIMEOUT_MS = 10_000;

const KEYCHAIN_COMMAND = '/usr/bin/security';
const KEYCHAIN_ARGS = ['find-generic-password', '-a', 'cursor-user', '-s', 'cursor-access-token', '-w'];

/** Credential stores in which the Cursor CLI keeps the token in a file instead of the macOS Keychain. */
const NON_KEYCHAIN_STORES = new Set(['file', 'memory']);

const AUTH_FILE_SCHEMA = z.object({ accessToken: z.string() });

/** Connect JSON leaves out fields with default values and sends 64-bit integers as strings. */
const PLAN_USAGE_SCHEMA = z.object({
  totalPercentUsed: z.number().optional(),
  autoPercentUsed: z.number().optional(),
  apiPercentUsed: z.number().optional(),
  limit: z.coerce.number().optional(),
  includedSpend: z.coerce.number().optional(),
});

type PlanUsage = z.infer<typeof PLAN_USAGE_SCHEMA>;

const CURRENT_PERIOD_USAGE_SCHEMA = z.object({
  billingCycleStart: z.coerce.number().optional(),
  billingCycleEnd: z.coerce.number().optional(),
  planUsage: PLAN_USAGE_SCHEMA.optional(),
});

const DAY_MS = 86_400_000;

@Injectable()
export class CursorAdapter extends AbstractAcpAdapter {
  readonly agentName = 'cursor';

  constructor(
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
    @Optional() preferredConfig?: AgentConfig,
  ) {
    super(preferredConfig ?? {});
  }

  /**
   * Reads the plan usage from the Cursor API with the access token the Cursor CLI stored at login, looked up in the
   * same order the CLI uses. The token is never refreshed, logged or sent anywhere else.
   */
  override async getQuota(): Promise<AgentQuota | undefined> {
    try {
      const token = await this.resolveAccessToken();
      if (!token || this.isExpired(token)) {
        return undefined;
      }
      const endpoint = (process.env.CURSOR_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, '');
      const response = await fetch(`${endpoint}${USAGE_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          authorization: `Bearer ${token}`,
          'x-cursor-client-type': 'cli',
          'x-ghost-mode': 'true',
        },
        body: '{}',
        signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.debug(`quota_failed: HTTP ${response.status}`);
        return undefined;
      }
      const parsed = CURRENT_PERIOD_USAGE_SCHEMA.safeParse(await response.json());
      return parsed.success ? this.toQuota(parsed.data) : undefined;
    } catch (error) {
      this.logger.debug(`quota_failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return undefined;
    }
  }

  protected spawnAgentProcess(): ChildProcess {
    const cwd = tmpdir();
    return this.processRunner.spawn(this.resolveBinary(), CURSOR_ARGS, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildAgentEnv(cwd),
    });
  }

  /**
   * Cursor blocks on its own methods to ask the user a question or to approve a plan. Answering
   * with the negative outcome, the only one that carries a message, sends the agent back to its
   * final response instead of leaving the turn waiting.
   */
  protected override agentExtensionRequests(): readonly AgentExtensionRequest[] {
    return [
      {
        method: 'cursor/ask_question',
        parseParams: (params: unknown) => params,
        respond: () => ({ outcome: { outcome: 'skipped', reason: QUESTION_REDIRECT } }),
      },
      {
        method: 'cursor/create_plan',
        parseParams: (params: unknown) => params,
        respond: () => ({ outcome: { outcome: 'rejected', reason: PLAN_REDIRECT } }),
      },
    ];
  }

  /**
   * Cursor publishes the reasoning level only inside the model id and has no separate effort
   * option, so the level goes into the displayed name to tell the variants of a model apart.
   */
  protected override mapModel(option: SessionConfigSelectOption): AgentModelInfo {
    const params = this.parseModelParams(option.value);
    if (params.size === 0) {
      return super.mapModel(option);
    }

    const effort = this.describeEffort(params);
    const name = effort ? `${option.name} (${effort})` : option.name;
    return {
      modelId: option.value,
      name,
      displayName: name,
      description: Array.from(params, ([key, value]) => `${key}=${value}`).join(', '),
    };
  }

  private async resolveAccessToken(): Promise<string | undefined> {
    const fromEnv = process.env.CURSOR_AUTH_TOKEN?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    const store = process.env.AGENT_CLI_CREDENTIAL_STORE ?? '';
    if (process.platform === 'darwin' && !NON_KEYCHAIN_STORES.has(store)) {
      const { exitCode, output } = await this.processRunner.run(KEYCHAIN_COMMAND, KEYCHAIN_ARGS);
      return exitCode === 0 ? output.trim() || undefined : undefined;
    }
    const authFile = this.authFilePath(store);
    return authFile ? this.readAuthFileToken(authFile) : undefined;
  }

  /** On macOS only the `file` store writes `auth.json`; the `memory` store keeps no token between runs. */
  private authFilePath(store: string): string | undefined {
    const home = homedir();
    if (process.platform === 'win32') {
      return this.fileSystem.joinPath(process.env.APPDATA || this.fileSystem.joinPath(home, 'AppData', 'Roaming'), 'Cursor', 'auth.json');
    }
    if (process.platform === 'darwin') {
      return store === 'file' ? this.fileSystem.joinPath(home, '.cursor', 'auth.json') : undefined;
    }
    return this.fileSystem.joinPath(process.env.XDG_CONFIG_HOME || this.fileSystem.joinPath(home, '.config'), 'cursor', 'auth.json');
  }

  private async readAuthFileToken(path: string): Promise<string | undefined> {
    const content = await this.fileSystem.readText(path);
    if (content === null) {
      return undefined;
    }
    try {
      const parsed = AUTH_FILE_SCHEMA.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data.accessToken.trim() || undefined : undefined;
    } catch {
      return undefined;
    }
  }

  /** A token that is not a JWT, or has no `exp`, goes to the API, which decides whether it is valid. */
  private isExpired(token: string): boolean {
    const payload = token.split('.')[1];
    if (!payload) {
      return false;
    }
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
      return typeof exp === 'number' && exp <= Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }

  /** Without plan usage the plan does not expose a limit, so there is nothing to show. */
  private toQuota({ planUsage, billingCycleStart, billingCycleEnd }: z.infer<typeof CURRENT_PERIOD_USAGE_SCHEMA>): AgentQuota | undefined {
    if (!planUsage) {
      return undefined;
    }
    const window = this.cycleWindow(billingCycleStart, billingCycleEnd);
    const resetTime = billingCycleEnd === undefined ? undefined : new Date(billingCycleEnd).toISOString();
    const bucket = (id: string, name: string, usedPercent: number, description?: string): AgentQuotaBucket => ({
      id,
      name,
      window,
      remainingFraction: Math.min(1, Math.max(0, 1 - usedPercent / 100)),
      ...(resetTime ? { resetTime } : {}),
      ...(description ? { description } : {}),
    });
    return {
      groups: [
        {
          name: 'Cursor',
          buckets: [
            bucket('included', 'Included usage', this.includedPercent(planUsage), 'Usage included in the plan'),
            bucket('auto', 'Auto', planUsage.autoPercentUsed ?? 0),
            bucket('api', 'API', planUsage.apiPercentUsed ?? 0),
          ],
        },
      ],
    };
  }

  /** The included usage follows the plan cycle: monthly for a Cursor subscription, weekly for some linked accounts. */
  private cycleWindow(start: number | undefined, end: number | undefined): string {
    if (start === undefined || end === undefined) {
      return 'cycle';
    }
    const days = Math.round((end - start) / DAY_MS);
    if (days === 1) {
      return 'daily';
    }
    if (days === 7) {
      return 'weekly';
    }
    return days >= 28 && days <= 31 ? 'monthly' : 'cycle';
  }

  private includedPercent({ totalPercentUsed, limit, includedSpend }: PlanUsage): number {
    if (totalPercentUsed !== undefined) {
      return totalPercentUsed;
    }
    return limit && includedSpend !== undefined ? (includedSpend / limit) * 100 : 0;
  }

  private resolveBinary(): string {
    return CURSOR_BINARIES.find(binary => this.fileSystem.resolveInPath(binary)) ?? CURSOR_BINARIES[0];
  }

  private parseModelParams(modelId: string): Map<string, string> {
    const params = MODEL_PARAMS_PATTERN.exec(modelId)?.groups?.params ?? '';
    return new Map(
      params
        .split(',')
        .map(param => param.trim())
        .filter(Boolean)
        .map((param) => {
          const [key = '', ...value] = param.split('=');
          return [key.trim(), value.join('=').trim()] as const;
        }),
    );
  }

  private describeEffort(params: ReadonlyMap<string, string>): string | undefined {
    const effortKey = EFFORT_PARAM_KEYS.find(key => params.get(key));
    const parts = effortKey ? [params.get(effortKey)!] : [];
    if (params.get('fast') === 'true') {
      parts.push('fast');
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
}
