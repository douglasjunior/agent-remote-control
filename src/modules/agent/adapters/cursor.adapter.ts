import type { SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { AgentConfig, AgentModelInfo } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import {
  AbstractAcpAdapter,
  type AgentExtensionRequest,
} from './abstract-acp.adapter.js';


/** Older installations only ship `cursor-agent`; the generic `agent` comes last because it may belong to another tool. */
const CURSOR_BINARIES = ['cursor-agent', 'agent'] as const;

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
