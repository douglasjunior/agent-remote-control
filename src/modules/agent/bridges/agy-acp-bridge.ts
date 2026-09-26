import {
  agent as acpAgent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  AgentContext,
  PromptResponse,
  SessionConfigOption,
  StopReason,
} from '@agentclientprotocol/sdk';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { Readable, Writable } from 'node:stream';


type AgyInitEvent = {
  readonly event: 'init';
  readonly conversation_id: string;
  readonly init: {
    readonly model: string;
    readonly cwd: string;
    readonly tools: readonly string[];
  };
};

type AgyUsage = {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly thinking_tokens: number;
  readonly cache_read_tokens: number;
  readonly total_tokens: number;
};

type AgyStepUpdateEvent = {
  readonly event: 'step_update';
  readonly step_update: {
    readonly conversation_id: string;
    readonly step_index: number;
    readonly state: 'ACTIVE' | 'DONE' | 'ERROR';
    readonly step_type: 'user_input' | 'agent_response' | 'tool';
    readonly text_delta?: string;
    readonly tool_name?: string;
    readonly tool_info?: {
      readonly name: string;
      readonly parameters: Record<string, unknown>;
      readonly output?: string;
      readonly error?: { readonly type: string; readonly message: string };
    };
    readonly usage?: AgyUsage;
  };
};

type AgyResultEvent = {
  readonly event: 'result';
  readonly result: {
    readonly conversation_id: string;
    readonly status: 'SUCCESS' | 'ERROR';
    readonly response: string;
    readonly num_turns: number;
    readonly usage: AgyUsage;
    readonly error?: string;
  };
};

type AgyEvent = AgyInitEvent | AgyStepUpdateEvent | AgyResultEvent;

type PendingPrompt = {
  readonly client: AgentContext;
  readonly resolve: (response: PromptResponse) => void;
  readonly reject: (error: Error) => void;
};

type AgyRun = {
  readonly proc: ChildProcess;
  readonly stdin: Writable;
  // SIGINT was sent: the run only settles its own prompt and never receives another one.
  interrupted: boolean;
  pendingPrompt: PendingPrompt | null;
};

const INIT_TIMEOUT_MS = 15_000;
const PRINT_TIMEOUT = '8760h';

export class AgyBridgeServer {
  private run: AgyRun | null = null;
  private currentSessionId: string | null = null;
  private currentCwd: string | null = null;
  private selectedModel: string | null = null;
  private activeModel: string | null = null;
  private discoveredModels:
    readonly { readonly value: string; readonly name: string }[] | null = null;

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, embeddedContext: false },
        sessionCapabilities: { close: {} },
      },
      agentInfo: {
        name: 'agy-acp-bridge',
        title: 'Google Antigravity (AGY)',
        version: '1.0.0',
      },
    };
  }

  async newSession(params: { readonly cwd: string }) {
    this.currentCwd = params.cwd;
    const { sessionId } = await this.startAgyProcess(params.cwd);
    const models = await this.getModels();

    return {
      sessionId,
      configOptions: this.buildConfigOptions(models),
    };
  }

  async loadSession(params: {
    readonly cwd: string;
    readonly sessionId: string;
  }) {
    this.currentCwd = params.cwd;
    await this.startAgyProcess(params.cwd, params.sessionId);
    this.currentSessionId = params.sessionId;
    const models = await this.getModels();

    return {
      configOptions: this.buildConfigOptions(models),
    };
  }

  async setConfigOption(params: {
    readonly sessionId: string;
    readonly configId: string;
    readonly value: unknown;
  }) {
    let changed = false;
    const stringValue = String(params.value);
    if (params.configId === 'model' && this.selectedModel !== stringValue) {
      this.selectedModel = stringValue;
      changed = true;
    }

    if (changed && this.currentCwd && !this.run?.pendingPrompt) {
      await this.startAgyProcess(
        this.currentCwd,
        this.currentSessionId ?? undefined,
      );
    }

    const models = await this.getModels();
    return {
      configOptions: this.buildConfigOptions(models),
    };
  }

  async prompt(
    params: {
      readonly sessionId: string;
      readonly prompt: readonly {
        readonly type: string;
        readonly text?: string;
      }[];
    },
    client: AgentContext,
  ): Promise<PromptResponse> {
    if (this.run?.pendingPrompt) {
      throw new Error('Another prompt is already in progress');
    }

    const run = this.run && !this.run.interrupted
      ? this.run
      : await this.restartRun();
    const text = params.prompt.map(p => p.text ?? '').join('\n');
    const inputPayload =
      JSON.stringify({ event: 'user', message: { content: text } }) + '\n';

    return new Promise<PromptResponse>((resolve, reject) => {
      run.pendingPrompt = { client, resolve, reject };
      run.stdin.write(inputPayload);
    });
  }

  cancel(): void {
    if (!this.run) {
      return;
    }
    this.run.interrupted = true;
    this.run.proc.kill('SIGINT');
  }

  async closeSession() {
    this.terminateRun(this.run);
    this.currentSessionId = null;
    this.currentCwd = null;
    this.activeModel = null;
    return {};
  }

  private async restartRun(): Promise<AgyRun> {
    if (!this.currentCwd) {
      throw new Error('AGY process is not running');
    }
    const { run } = await this.startAgyProcess(
      this.currentCwd,
      this.currentSessionId ?? undefined,
    );
    return run;
  }

  private buildConfigOptions(
    models: readonly { readonly value: string; readonly name: string }[],
  ): SessionConfigOption[] {
    const currentValue = this.selectedModel ?? this.activeModel ?? '';
    return [
      {
        id: 'model',
        type: 'select' as const,
        name: 'Model',
        currentValue,
        options: models.map(model => ({
          value: model.value,
          name: model.name,
        })),
      },
    ];
  }

  private async getModels(): Promise<
    readonly { readonly value: string; readonly name: string }[]
  > {
    if (this.discoveredModels && this.discoveredModels.length > 0) {
      return this.discoveredModels;
    }
    const models = await this.loadAvailableModels();
    if (models.length > 0) {
      this.discoveredModels = models;
    }
    return models;
  }

  private async loadAvailableModels(): Promise<
    { readonly value: string; readonly name: string }[]
  > {
    const agyBin = process.env.AGY_PATH || 'agy';
    return new Promise<{ readonly value: string; readonly name: string }[]>(
      (resolve) => {
        execFile(
          agyBin,
          ['models'],
          { timeout: 10_000, env: process.env },
          (error, stdout) => {
            if (error || !stdout) {
              resolve([]);
              return;
            }

            const parsed: { readonly value: string; readonly name: string }[] =
              [];
            for (const line of stdout.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const [value, ...nameParts] = trimmed.split('\t');
              const trimmedValue = value?.trim();
              const trimmedName = nameParts.join('\t').trim();
              if (trimmedValue) {
                parsed.push({
                  value: trimmedValue,
                  name: trimmedName || trimmedValue,
                });
              }
            }
            resolve(parsed);
          },
        );
      },
    );
  }

  private async startAgyProcess(
    cwd: string,
    resumeConversationId?: string,
  ): Promise<{ readonly run: AgyRun; readonly sessionId: string }> {
    this.terminateRun(this.run);

    const agyBin = process.env.AGY_PATH || 'agy';
    const args = [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--print=',
      '--print-timeout',
      PRINT_TIMEOUT,
      '--add-dir',
      cwd,
    ];
    if (this.selectedModel) {
      args.push('--model', this.selectedModel);
    }
    if (resumeConversationId) {
      args.push('--conversation', resumeConversationId);
    }

    const proc = spawn(agyBin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    if (!proc.stdout || !proc.stdin) {
      proc.kill();
      throw new Error('Failed to open stdio streams for AGY process');
    }

    const run: AgyRun = {
      proc,
      stdin: proc.stdin,
      interrupted: false,
      pendingPrompt: null,
    };
    this.run = run;
    proc.stdin.on('error', () => undefined);

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', line => this.handleAgyLine(run, line));
    proc.stderr?.on('data', chunk => process.stderr.write(chunk));
    proc.on('exit', (code, signal) => this.handleExit(run, code, signal));

    let initEvent: AgyInitEvent;
    try {
      initEvent = await this.waitForInitEvent(proc, rl);
    } catch (error) {
      this.terminateRun(run);
      throw error;
    }
    this.activeModel = initEvent.init.model;
    if (!resumeConversationId) {
      this.currentSessionId = initEvent.conversation_id;
    }
    return { run, sessionId: this.currentSessionId ?? initEvent.conversation_id };
  }

  private terminateRun(run: AgyRun | null): void {
    if (!run) {
      return;
    }
    run.proc.kill('SIGTERM');
    if (this.run === run) {
      this.run = null;
    }
    this.takePendingPrompt(run)?.reject(new Error('AGY process was terminated'));
  }

  private handleExit(
    run: AgyRun,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.run === run) {
      this.run = null;
    }
    if (run.interrupted || signal === 'SIGINT') {
      this.resolvePrompt(run, 'cancelled');
      return;
    }
    this.takePendingPrompt(run)?.reject(
      new Error(`AGY process exited prematurely (code=${code}, signal=${signal})`),
    );
  }

  private handleAgyLine(run: AgyRun, line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      const parsed = JSON.parse(trimmed) as AgyEvent;
      if (parsed.event === 'step_update') {
        this.forwardStepUpdate(run, parsed.step_update);
      } else if (parsed.event === 'result') {
        this.settlePrompt(run, parsed.result);
      }
    } catch {
      // ignore malformed line
    }
  }

  private forwardStepUpdate(run: AgyRun, update: AgyStepUpdateEvent['step_update']): void {
    const client = run.pendingPrompt?.client;
    if (!client || !this.currentSessionId) return;

    if (update.step_type === 'agent_response' && update.text_delta) {
      void client.notify(methods.client.session.update, {
        sessionId: this.currentSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: update.text_delta },
        },
      });
    } else if (update.step_type === 'tool') {
      const toolCallId = `step_${update.step_index}`;
      const toolName = update.tool_name ?? update.tool_info?.name;
      const title = this.formatToolTitle(
        toolName,
        update.tool_info?.parameters,
      );
      if (update.state === 'ACTIVE') {
        void client.notify(methods.client.session.update, {
          sessionId: this.currentSessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            title,
            status: 'in_progress',
          },
        });
      } else if (update.state === 'DONE') {
        void client.notify(methods.client.session.update, {
          sessionId: this.currentSessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            title,
            status: 'completed',
            content: update.tool_info?.output
              ? [
                {
                  type: 'content',
                  content: { type: 'text', text: update.tool_info.output },
                },
              ]
              : undefined,
          },
        });
      } else if (update.state === 'ERROR') {
        const errorMessage = update.tool_info?.error?.message;
        void client.notify(methods.client.session.update, {
          sessionId: this.currentSessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            title,
            status: 'failed',
            content: errorMessage
              ? [
                {
                  type: 'content',
                  content: { type: 'text', text: errorMessage },
                },
              ]
              : undefined,
          },
        });
      }
    }
  }

  private settlePrompt(run: AgyRun, result: AgyResultEvent['result']): void {
    const cancelled = run.interrupted || result.error === 'interrupted';
    const abandonedTurn = (result.usage?.total_tokens ?? 0) === 0;
    const failed = result.status === 'ERROR' || abandonedTurn;

    if (failed && !result.response && !cancelled) {
      const fallbackMessage =
        result.status === 'ERROR'
          ? 'AGY execution failed'
          : 'AGY abandoned the turn without producing a response';
      this.takePendingPrompt(run)?.reject(new Error(result.error || fallbackMessage));
      return;
    }

    this.resolvePrompt(run, cancelled ? 'cancelled' : 'end_turn', result.usage);
  }

  private resolvePrompt(run: AgyRun, stopReason: StopReason, usage?: AgyUsage): void {
    this.takePendingPrompt(run)?.resolve({
      stopReason,
      usage: {
        totalTokens: usage?.total_tokens ?? 0,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        thoughtTokens: usage?.thinking_tokens ?? 0,
        cachedReadTokens: usage?.cache_read_tokens ?? 0,
      },
    });
  }

  private takePendingPrompt(run: AgyRun): PendingPrompt | null {
    const pending = run.pendingPrompt;
    run.pendingPrompt = null;
    return pending;
  }

  private waitForInitEvent(
    proc: ChildProcess,
    rl: Interface,
  ): Promise<AgyInitEvent> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timeout waiting for AGY init event'));
      }, INIT_TIMEOUT_MS);

      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const onExit = (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `AGY process exited prematurely (code=${code}, signal=${signal})`,
          ),
        );
      };

      const onLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          const parsed = JSON.parse(trimmed) as AgyEvent;
          if (parsed.event === 'init') {
            settled = true;
            cleanup();
            resolve(parsed);
          }
        } catch {
          // ignore malformed line
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        proc.off('error', onError);
        proc.off('exit', onExit);
        rl.off('line', onLine);
      };

      proc.once('error', onError);
      proc.once('exit', onExit);
      rl.on('line', onLine);
    });
  }

  private toDisplayPath(filePath: string): string {
    const normalized = filePath.trim();
    if (!isAbsolute(normalized) && !normalized.startsWith('~')) {
      return normalized;
    }
    if (this.currentCwd) {
      const resolvedCwd = resolve(this.currentCwd);
      const resolvedFile = resolve(normalized);
      if (resolvedFile === resolvedCwd) {
        return '.';
      }
      if (resolvedFile.startsWith(resolvedCwd + sep)) {
        return relative(resolvedCwd, resolvedFile);
      }
    }
    const home = homedir();
    if (normalized === home) {
      return '~';
    }
    if (normalized.startsWith(home + sep)) {
      return `~${sep}${relative(home, normalized)}`;
    }
    return normalized;
  }

  private formatToolTitle(
    toolName: string | undefined,
    rawParams: Record<string, unknown> | undefined,
  ): string {
    const name = toolName;
    if (!name) {
      return 'tool';
    }

    const params = rawParams ?? {};
    const getStringParam = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const val = params[key];
        if (typeof val === 'string') {
          const cleaned = val.replace(/^["']|["']$/g, '').trim();
          if (cleaned.length > 0) {
            return cleaned;
          }
        }
      }
      return undefined;
    };

    switch (name) {
      case 'view_file': {
        const targetPath = getStringParam('AbsolutePath', 'FilePath', 'path');
        if (!targetPath) return 'View file';
        const display = this.toDisplayPath(targetPath);
        const start = params.StartLine;
        const end = params.EndLine;
        if (typeof start === 'number' && typeof end === 'number') {
          return `View ${display} lines ${start}-${end}`;
        }
        if (typeof start === 'number') {
          return `View ${display} from line ${start}`;
        }
        return `View ${display}`;
      }
      case 'list_dir': {
        const targetPath = getStringParam('DirectoryPath', 'path', 'dir');
        return targetPath
          ? `List ${this.toDisplayPath(targetPath)}`
          : 'List directory';
      }
      case 'write_to_file': {
        const targetPath = getStringParam('TargetFile', 'AbsolutePath', 'path');
        return targetPath
          ? `Write ${this.toDisplayPath(targetPath)}`
          : 'Write file';
      }
      case 'replace_file_content':
      case 'multi_replace_file_content':
      case 'sed_file': {
        const targetPath = getStringParam('TargetFile', 'AbsolutePath', 'path');
        return targetPath
          ? `Edit ${this.toDisplayPath(targetPath)}`
          : 'Edit file';
      }
      case 'run_command': {
        const cmd = getStringParam('CommandLine', 'command');
        if (cmd) {
          const singleLine = cmd.replace(/[\r\n]+/g, ' ').trim();
          return singleLine.length > 60
            ? `Run ${singleLine.slice(0, 59)}…`
            : `Run ${singleLine}`;
        }
        return 'Run command';
      }
      case 'grep_search': {
        const query = getStringParam('Query', 'query');
        const searchPath = getStringParam('SearchPath', 'path');
        const displayPath = searchPath
          ? ` in ${this.toDisplayPath(searchPath)}`
          : '';
        return query ? `Grep "${query}"${displayPath}` : 'Grep search';
      }
      case 'find_by_name': {
        const pattern = getStringParam('Pattern', 'pattern');
        const searchDir = getStringParam('SearchDirectory', 'dir', 'path');
        const displayDir = searchDir
          ? ` in ${this.toDisplayPath(searchDir)}`
          : '';
        return pattern ? `Find "${pattern}"${displayDir}` : 'Find files';
      }
      case 'search_web': {
        const query = getStringParam('query', 'Query');
        return query ? `Search "${query}"` : 'Web search';
      }
      case 'read_url_content': {
        const url = getStringParam('Url', 'url');
        return url ? `Read ${url}` : 'Read URL';
      }
      case 'open_browser_url': {
        const url = getStringParam('Url', 'url');
        return url ? `Open ${url}` : 'Open browser';
      }
      case 'ask_question': {
        const questions = Array.isArray(params.questions)
          ? params.questions
          : [];
        const first = questions[0] as { question?: unknown } | undefined;
        const text =
          typeof first?.question === 'string' ? first.question : undefined;
        return text ? `Question: ${text}` : 'Ask question';
      }
      case 'manage_task': {
        const action = getStringParam('Action', 'action');
        const taskId = getStringParam('TaskId', 'taskId');
        if (action && taskId) return `Task ${action} ${taskId}`;
        if (action) return `Task ${action}`;
        return 'Manage task';
      }
      case 'command_status': {
        const taskId = getStringParam('TaskId', 'taskId');
        return taskId ? `Check task ${taskId}` : 'Check task status';
      }
      case 'invoke_subagent': {
        const subagents = Array.isArray(params.Subagents)
          ? params.Subagents
          : [];
        const first = subagents[0] as
          { Role?: unknown; TypeName?: unknown } | undefined;
        const role =
          typeof first?.Role === 'string'
            ? first.Role
            : typeof first?.TypeName === 'string'
              ? first.TypeName
              : undefined;
        return role ? `Subagent: ${role}` : 'Subagent';
      }
      default: {
        const action = getStringParam('toolAction', 'toolSummary');
        return action ?? name;
      }
    }
  }
}

export function runAgyBridge() {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin);
  const stream = ndJsonStream(
    input as WritableStream<Uint8Array>,
    output as ReadableStream<Uint8Array>,
  );

  const server = new AgyBridgeServer();
  const terminate = () => {
    void server.closeSession();
    process.exit(0);
  };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);

  acpAgent({ name: 'agy-acp-bridge' })
    .onRequest(methods.agent.initialize, () => server.initialize())
    .onRequest(methods.agent.session.new, ctx =>
      server.newSession(ctx.params))
    .onRequest(methods.agent.session.load, ctx =>
      server.loadSession(ctx.params))
    .onRequest(methods.agent.session.setConfigOption, ctx =>
      server.setConfigOption(ctx.params))
    .onRequest(methods.agent.session.prompt, ctx =>
      server.prompt(ctx.params, ctx.client))
    .onNotification(methods.agent.session.cancel, () => server.cancel())
    .onRequest(methods.agent.session.close, () => server.closeSession())
    .connect(stream);
}

/* v8 ignore start */
if (
  process.argv[1]
  && (process.argv[1].endsWith('agy-acp-bridge.ts')
    || process.argv[1].endsWith('agy-acp-bridge.js'))
) {
  runAgyBridge();
}
/* v8 ignore stop */
