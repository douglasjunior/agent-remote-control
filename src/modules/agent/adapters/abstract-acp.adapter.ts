import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
  type ParamsParser,
  type PermissionOption,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionConfigSelectOptions,
  type SessionNotification,
  type Usage,
} from '@agentclientprotocol/sdk';
import { Logger } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';

import { AgentStreamDemux } from '../demux/agent-stream-demux.js';
import {
  PromptCancelledError,
  type AgentActivity,
  type AgentConfig,
  type AgentEffortState,
  type AgentModelInfo,
  type AgentModelState,
  type AgentUpdate,
  type AgentUsage,
  type IAgentPort,
} from '../ports/agent.port.js';

import { ResumedSession, type SessionHandle } from './resumed-session.js';


type SessionConfigOptionSelect = SessionConfigOption & { type: 'select' };
type ConfigCategory = 'model' | 'thought_level' | 'permissions';

const CANCEL_ESCALATION_MS = 5_000;
const CANCEL_FORCE_GRACE_MS = 15_000;
const STEERING_METHOD = '_session/steering';

const PERMISSION_ALLOW_PREFERENCE: readonly PermissionOption['kind'][] = [
  'allow_always',
  'allow_once',
];

export type AgentExtensionRequest = {
  readonly method: string;
  readonly parseParams: ParamsParser<unknown>;
  readonly respond: () => unknown;
};

export type SessionConfigPreset = {
  readonly category: ConfigCategory;
  readonly value: string;
};

export const CANCEL_ABORT_PROMPT_TEXT =
  'The user requested cancellation. Immediately stop the current execution and every subagent you have spawned, and end your turn now. Do not start any new actions.';

export abstract class AbstractAcpAdapter implements IAgentPort {
  private connection: ClientConnection | null = null;
  private activeSession: SessionHandle | null = null;
  private subprocess: ChildProcess | null = null;
  currentSessionId: string | undefined = undefined;
  private readonly activityListeners = new Set<
    (activity: AgentActivity) => void
  >();

  private readonly demux = new AgentStreamDemux(activity =>
    this.emitActivity(activity));

  private stderrBuffer = '';
  private stderrListener: ((chunk: Buffer) => void) | null = null;
  private transportLostListener: ((reason: unknown) => void) | null = null;
  private cachedConfigOptions: SessionConfigOption[] = [];
  private preferredConfig: AgentConfig;
  protected readonly logger = new Logger(this.constructor.name);

  lastAgentMessage = '';
  private _lastRoundUsage: AgentUsage | undefined;
  private cancelPending = false;
  private forcePromptCompletion: (() => void) | null = null;
  private cancelTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private cancelledSeq = 0;
  private steeringSupported = false;
  private loadSessionSupported = false;

  get supportsSteering(): boolean {
    return this.steeringSupported;
  }

  constructor(preferredConfig: AgentConfig = {}) {
    this.preferredConfig = preferredConfig;
  }

  async getLastRoundUsage(): Promise<AgentUsage | undefined> {
    if (this._lastRoundUsage || !this.currentSessionId) {
      return this._lastRoundUsage;
    }
    try {
      this._lastRoundUsage = await this.collectFallbackUsage(
        this.currentSessionId,
      );
    } catch (error) {
      this.logger.debug(
        `fallback_usage_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    return this._lastRoundUsage;
  }

  protected abstract spawnAgentProcess(): ChildProcess;

  abstract readonly agentName: string;

  protected mapModel(option: SessionConfigSelectOption): AgentModelInfo {
    return {
      modelId: option.value,
      name: option.name,
      displayName: option.name,
      description:
        option.description && option.description !== option.name
          ? option.description
          : undefined,
    };
  }

  protected async collectFallbackUsage(
    _sessionId: string,
  ): Promise<AgentUsage | undefined> {
    return undefined;
  }

  protected agentExtensionRequests(): readonly AgentExtensionRequest[] {
    return [];
  }

  protected sessionConfigPresets(): readonly SessionConfigPreset[] {
    return [];
  }

  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    this.stderrBuffer = '';

    try {
      const proc = this.spawnAgentProcess();
      this.subprocess = proc;

      if (!proc.stdin || !proc.stdout || !proc.stderr) {
        throw new Error(
          'Agent process was spawned without piped stdio streams.',
        );
      }

      this.stderrListener = (chunk: Buffer) => {
        this.stderrBuffer += chunk.toString('utf8');
      };
      proc.stderr.on('data', this.stderrListener);

      const transportLostListener = (reason: unknown) =>
        this.handleTransportLost(reason);
      this.transportLostListener = transportLostListener;
      proc.once('exit', transportLostListener);
      proc.once('error', transportLostListener);

      const input = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
      const output = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
      const stream = ndJsonStream(input, output);

      let app: ClientApp = client()
        .onNotification('session/update', ({ params }) => {
          this.syncConfigOptions(params);
          if (this.activeSession instanceof ResumedSession) {
            this.activeSession.route(params);
          }
        })
        .onRequest('session/request_permission', ({ params }) => ({
          outcome: {
            outcome: 'selected' as const,
            optionId: this.pickPermissionOption(params.options),
          },
        }));

      for (const extension of this.agentExtensionRequests()) {
        app = app.onRequest(extension.method, extension.parseParams, () =>
          extension.respond());
      }

      const connection = app.connect(stream);

      const initializeResponse = await connection.agent.request(
        'initialize',
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        },
      );

      this.steeringSupported = this.readSteeringSupport(initializeResponse);
      this.loadSessionSupported = this.readLoadSessionSupport(initializeResponse);
      this.logger.debug(
        `capabilities_detected: steering=${this.steeringSupported} loadSession=${this.loadSessionSupported}`,
      );
      this.connection = connection;
    } catch (err) {
      const error = this.buildTransportError(err, 'connect');
      this.releaseTransport();
      throw error;
    }

    await this.discoverConfigOptions(this.connection);
  }

  private readSteeringSupport(initializeResponse: unknown): boolean {
    const meta = (
      initializeResponse as
        { _meta?: { steering?: { supported?: unknown } } } | undefined
    )?._meta;
    return meta?.steering?.supported === true;
  }

  private readLoadSessionSupport(initializeResponse: unknown): boolean {
    const capabilities = (
      initializeResponse as
        { agentCapabilities?: { loadSession?: unknown } } | undefined
    )?.agentCapabilities;
    return capabilities?.loadSession === true;
  }

  private handleTransportLost(reason: unknown): void {
    this.logger.warn(`agent_process_exited: ${String(reason)}`);
    this.discardSessionAndTransport();
  }

  private pickPermissionOption(options: readonly PermissionOption[]): string {
    for (const kind of PERMISSION_ALLOW_PREFERENCE) {
      const match = options.find(option => option.kind === kind);
      if (match) {
        return match.optionId;
      }
    }
    return options[0]?.optionId ?? '';
  }

  private async discoverConfigOptions(
    connection: ClientConnection,
  ): Promise<void> {
    try {
      const response = await connection.agent.request('session/new', {
        cwd: tmpdir(),
        mcpServers: [],
      });
      this.cachedConfigOptions = response.configOptions ?? [];

      try {
        await connection.agent.request('session/close', {
          sessionId: response.sessionId,
        });
      } catch {
        // ignore errors closing the discovery session
      }
    } catch (error) {
      this.logger.warn(
        `discover_config_options_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async createSession(cwd: string): Promise<void> {
    if (!this.connection) {
      throw new Error('Not connected. Call connect() first.');
    }

    this.stderrBuffer = '';

    let configOptions: SessionConfigOption[] | null | undefined;
    try {
      const session = await this.connection.agent
        .buildSession({ cwd, mcpServers: [] })
        .start();
      this.activeSession = session;
      this.currentSessionId = session.sessionId;
      configOptions = session.newSessionResponse.configOptions;
    } catch (err) {
      throw this.buildTransportError(err, 'createSession');
    }

    await this.applySessionConfig(configOptions);
  }

  async loadSession(cwd: string, sessionId: string): Promise<boolean> {
    if (!this.connection) {
      throw new Error('Not connected. Call connect() first.');
    }

    if (!this.loadSessionSupported) {
      this.logger.debug(`load_session_unsupported: ${sessionId}`);
      return false;
    }

    this.stderrBuffer = '';

    const connection = this.connection;
    let configOptions: SessionConfigOption[] | null | undefined;
    try {
      const response = await connection.agent.request('session/load', {
        sessionId,
        cwd,
        mcpServers: [],
      });
      this.activeSession?.dispose();
      this.activeSession = new ResumedSession(sessionId, connection);
      this.currentSessionId = sessionId;
      configOptions = response.configOptions;
    } catch (error) {
      this.logger.warn(
        `load_session_failed (${sessionId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }

    await this.applySessionConfig(configOptions);
    return true;
  }

  private async applySessionConfig(
    configOptions: SessionConfigOption[] | null | undefined,
  ): Promise<void> {
    if (configOptions) {
      this.cachedConfigOptions = configOptions;
    }

    for (const preset of this.sessionConfigPresets()) {
      try {
        await this.applyConfigOption(preset.category, preset.value);
      } catch (error) {
        this.logger.warn(
          `apply_session_preset_failed (${preset.category}): ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    if (this.preferredConfig.modelId || this.preferredConfig.effortId) {
      try {
        await this.setConfig(this.preferredConfig);
      } catch (error) {
        this.logger.warn(
          `apply_preferred_config_failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  async* prompt(text: string): AsyncGenerator<AgentUpdate> {
    if (!this.connection)
      throw new Error('Not connected. Call connect() first.');
    if (!this.activeSession)
      throw new Error('No active session. Call createSession() first.');

    this.stderrBuffer = '';
    this.lastAgentMessage = '';
    this._lastRoundUsage = undefined;
    this.demux.reset();

    const session = this.activeSession;

    this.logger.debug(`prompt_round_start: ${this.currentSessionId}`);

    let forced = false;
    let resolveForce: () => void = () => undefined;
    const forcePromise = new Promise<void>((resolve) => {
      resolveForce = resolve;
    });
    this.forcePromptCompletion = () => {
      /* v8 ignore start */
      if (forced) return;
      /* v8 ignore stop */
      forced = true;
      resolveForce();
    };

    let thrownError: unknown = null;
    let finalBlock: AgentUpdate | null = null;

    try {
      const promptResponse = session.prompt(text);
      void promptResponse.catch(() => undefined);

      while (true) {
        const outcome = await Promise.race([
          session
            .nextUpdate()
            .then(message => ({ kind: 'message' as const, message })),
          forcePromise.then(() => ({ kind: 'forced' as const })),
        ]);

        if (outcome.kind === 'forced') {
          thrownError = new PromptCancelledError();
          break;
        }

        const { message } = outcome;
        if (message.kind === 'stop') {
          this._lastRoundUsage = this.toAgentUsage(message.response?.usage);
          this.logger.debug(
            `prompt_round_stop: ${this.currentSessionId} (reason=${message.stopReason})`,
          );
          if (message.stopReason === 'cancelled' || this.cancelPending) {
            thrownError = new PromptCancelledError();
          } else {
            finalBlock = this.buildFinalBlock();
          }
          break;
        }

        this.demux.handle(message.notification);
        this.lastAgentMessage = this.demux.lastAgentMessage;
      }
    } catch (err) {
      thrownError = err;
    } finally {
      this.resetStreamingState();
    }

    if (thrownError) {
      if (thrownError instanceof PromptCancelledError) {
        this.emitActivity({
          kind: 'cancelled',
          id: `cancelled:${this.cancelledSeq++}`,
        });
        throw thrownError;
      }
      throw this.buildTransportError(thrownError, 'prompt');
    }

    if (finalBlock) {
      yield finalBlock;
    }
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.currentSessionId || !this.forcePromptCompletion) {
      return;
    }

    this.cancelPending = true;


    this.cancelTimeoutHandle ??= setTimeout(
      () => this.escalateCancel(),
      CANCEL_ESCALATION_MS,
    );


    await this.sendCancelNotification(this.currentSessionId);
  }

  private escalateCancel(): void {
    this.cancelTimeoutHandle = null;
    /* v8 ignore start */
    if (!this.forcePromptCompletion || !this.currentSessionId) {
      return;
    }
    /* v8 ignore stop */

    const sessionId = this.currentSessionId;
    this.logger.warn(`cancel_escalation_abort: ${sessionId}`);

    if (this.steeringSupported) {
      this.sendSteeringPrompt(CANCEL_ABORT_PROMPT_TEXT);
    } else {
      void this.sendCancelNotification(sessionId);
    }

    this.cancelTimeoutHandle = setTimeout(
      () => this.forceCancel(sessionId),
      CANCEL_FORCE_GRACE_MS,
    );
  }

  private forceCancel(sessionId: string): void {
    this.cancelTimeoutHandle = null;
    /* v8 ignore start */
    if (!this.forcePromptCompletion) {
      return;
    }
    /* v8 ignore stop */
    this.logger.warn(`cancel_timeout_forced: ${sessionId}`);
    this.forcePromptCompletion();
    this.discardSessionAndTransport();
  }

  private async sendCancelNotification(sessionId: string): Promise<void> {
    /* v8 ignore start */
    if (!this.connection) return;
    /* v8 ignore stop */
    try {
      await this.connection.agent.notify('session/cancel', { sessionId });
    } catch (error) {
      this.logger.warn(
        `cancel_failed (${sessionId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  sendSteeringPrompt(text: string): void {
    if (!this.connection || !this.currentSessionId) {
      return;
    }
    const sessionId = this.currentSessionId;

    if (this.steeringSupported) {
      this.logger.debug(`steering_inject_sent: ${sessionId}`);
      void this.connection.agent
        .request(STEERING_METHOD, {
          sessionId,
          prompt: [{ type: 'text', text }],
          _meta: { steering: { idleBehavior: 'promptRequired' } },
        })
        .then((response: unknown) => {
          this.logger.debug(
            `steering_inject_resolved: ${sessionId} outcome=${(response as { outcome?: string } | undefined)?.outcome}`,
          );
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `steering_inject_failed (${sessionId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        });
      return;
    }

    this.logger.debug(`steering_prompt_sent: ${sessionId}`);
    void this.connection.agent
      .request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      })
      .then((response: unknown) => {
        this.logger.debug(
          `steering_prompt_resolved: ${sessionId} stopReason=${(response as { stopReason?: string } | undefined)?.stopReason}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `steering_prompt_failed (${sessionId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      });
  }

  async closeSession(): Promise<void> {
    if (!this.connection || !this.currentSessionId) {
      return;
    }

    const sessionId = this.currentSessionId;
    const session = this.activeSession;

    session?.dispose();
    this.activeSession = null;
    this.currentSessionId = undefined;

    try {
      await this.connection.agent.request('session/close', { sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!this.isMethodNotFoundError(message)) {
        this.logger.warn(`close_session_failed (${sessionId}): ${message}`);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.discardSessionAndTransport();
    this.cachedConfigOptions = [];
  }

  private discardSessionAndTransport(): void {
    this.activeSession?.dispose();
    this.activeSession = null;
    this.currentSessionId = undefined;
    this.releaseTransport();
  }

  private releaseTransport(): void {
    if (this.subprocess?.stderr && this.stderrListener) {
      this.subprocess.stderr.off('data', this.stderrListener);
    }
    if (this.subprocess && this.transportLostListener) {
      this.subprocess.off('exit', this.transportLostListener);
      this.subprocess.off('error', this.transportLostListener);
    }
    this.stderrListener = null;
    this.transportLostListener = null;
    this.stderrBuffer = '';

    this.subprocess?.kill();
    this.connection = null;
    this.subprocess = null;
  }

  getAvailableModels(): AgentModelState | null {
    const option = this.pickSelectOption(this.cachedConfigOptions, 'model');
    if (!option) return null;

    return {
      availableModels: this.flattenSelectOptions(option.options).map(opt =>
        this.mapModel(opt)),
      currentModelId: option.currentValue,
    };
  }

  async getAvailableEffortsForModel(
    modelId: string,
  ): Promise<AgentEffortState | null> {
    if (!this.connection) return null;

    let probeSessionId: string | null = null;
    try {
      const created = await this.connection.agent.request('session/new', {
        cwd: tmpdir(),
        mcpServers: [],
      });
      probeSessionId = created.sessionId;
      let options: SessionConfigOption[] = created.configOptions ?? [];

      const modelOption = this.pickSelectOption(options, 'model');
      if (modelOption && modelOption.currentValue !== modelId) {
        const response = await this.connection.agent.request(
          'session/set_config_option',
          {
            sessionId: probeSessionId,
            configId: modelOption.id,
            value: modelId,
          },
        );
        options = response.configOptions;
      }

      const effortOption = this.pickSelectOption(options, 'thought_level');
      if (!effortOption) return null;

      return {
        availableEfforts: this.flattenSelectOptions(effortOption.options).map(
          opt => ({
            effortId: opt.value,
            name: opt.name,
            description:
              opt.description && opt.description !== opt.name
                ? opt.description
                : undefined,
          }),
        ),
        currentEffortId: effortOption.currentValue,
      };
    } catch (err) {
      throw this.buildTransportError(err, 'getAvailableEffortsForModel');
    } finally {
      if (probeSessionId) {
        try {
          await this.connection.agent.request('session/close', {
            sessionId: probeSessionId,
          });
        } catch {
          // ignore errors closing the probe session
        }
      }
    }
  }

  async setConfig(config: AgentConfig): Promise<void> {
    this.preferredConfig = { ...this.preferredConfig, ...config };

    if (!this.connection || !this.currentSessionId) {
      return;
    }

    if (config.modelId !== undefined) {
      await this.applyConfigOption('model', config.modelId);
    }
    if (config.effortId !== undefined) {
      await this.applyConfigOption('thought_level', config.effortId);
    }
  }

  private async applyConfigOption(
    category: ConfigCategory,
    value: string,
  ): Promise<void> {
    /* v8 ignore start */
    if (!this.connection || !this.currentSessionId) return;
    /* v8 ignore stop */

    const option = this.pickSelectOption(this.cachedConfigOptions, category);
    if (!option) {
      this.logger.warn(`config_option_not_available: ${category}=${value}`);
      return;
    }

    if (option.currentValue === value) {
      return;
    }

    const exists = this.flattenSelectOptions(option.options).some(
      opt => opt.value === value,
    );
    if (!exists) {
      this.logger.warn(`config_option_value_unknown: ${category}=${value}`);
      return;
    }

    this.stderrBuffer = '';

    try {
      const response = await this.connection.agent.request(
        'session/set_config_option',
        {
          sessionId: this.currentSessionId,
          configId: option.id,
          value,
        },
      );
      this.cachedConfigOptions = response.configOptions;
    } catch (err) {
      throw this.buildTransportError(err, 'setConfig');
    }
  }

  private syncConfigOptions(notification: SessionNotification): void {
    if (notification.update.sessionUpdate === 'config_option_update') {
      this.cachedConfigOptions = notification.update.configOptions;
    }
  }

  onActivity(listener: (activity: AgentActivity) => void): () => void {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  }

  private resetStreamingState(): void {
    this.cancelPending = false;
    this.demux.reset();
    this.forcePromptCompletion = null;
    if (this.cancelTimeoutHandle) {
      clearTimeout(this.cancelTimeoutHandle);
      this.cancelTimeoutHandle = null;
    }
  }

  private emitActivity(activity: AgentActivity): void {
    for (const listener of this.activityListeners) {
      listener(activity);
    }
  }

  private buildFinalBlock(): AgentUpdate | null {
    const finalText = this.demux.takeFinalText();

    if (finalText.trim().length === 0) {
      return null;
    }

    this.lastAgentMessage = finalText.trim();
    return { kind: 'text', text: finalText };
  }

  protected buildTransportError(rawError: unknown, operation: string): Error {
    const rawMessage =
      rawError instanceof Error ? rawError.message : String(rawError);
    const stderr = this.stderrBuffer.trim();

    const lines = [
      `Erro retornado pelo agente (${this.agentName}):`,
      rawMessage,
    ];

    if (stderr.length > 0) {
      lines.push('', stderr);
    }

    this.logger.error(`transport_error (${operation}): ${rawMessage}`);

    const error = new Error(lines.join('\n'));
    if (rawError instanceof Error) {
      error.cause = rawError;
    }
    return error;
  }

  private pickSelectOption(
    options: readonly SessionConfigOption[],
    key: ConfigCategory,
  ): SessionConfigOptionSelect | null {
    const match = options.find(
      (option): option is SessionConfigOptionSelect =>
        option.type === 'select'
        && (option.id === key || option.category === key),
    );
    return match ?? null;
  }

  private flattenSelectOptions(
    options: SessionConfigSelectOptions,
  ): readonly SessionConfigSelectOption[] {
    return options.flatMap(item => ('value' in item ? [item] : item.options));
  }

  private isMethodNotFoundError(message: string): boolean {
    return message.includes('Method not found');
  }

  private toAgentUsage(
    usage: Usage | null | undefined,
  ): AgentUsage | undefined {
    if (!usage) return undefined;
    return {
      totalTokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thoughtTokens: usage.thoughtTokens ?? undefined,
      cachedReadTokens: usage.cachedReadTokens ?? undefined,
      cachedWriteTokens: usage.cachedWriteTokens ?? undefined,
    };
  }
}
