import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';

import {
  AGENT_AUTH_PROVIDERS,
  type AgentAuthProvider,
  type AgentStatusParse,
} from '../constants/agent-auth-providers.constant.js';
import type {
  AgentAuthInfo,
  AgentLoginEvent,
  AgentLoginListener,
  AgentLoginSubscription,
} from '../models/agent-auth.model.js';
import { IAgentAuthPort } from '../ports/agent-auth.port.js';
import { IAgentPortFactory } from '../ports/agent-port-factory.port.js';
import { AgentAuthRequiredError, type IAgentPort } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';
import { AgentAuthConfigService } from '../services/agent-auth-config.service.js';
import { buildAgentProcessEnv } from '../utils/agent-env.util.js';
import { LoginOutputParser } from '../utils/login-output-parser.util.js';


/** Programs a CLI may start to open a browser; no-op stand-ins win the PATH lookup so the link is only printed. */
const BROWSER_OPENERS = [
  'xdg-open',
  'sensible-browser',
  'x-www-browser',
  'www-browser',
  'gnome-open',
  'kde-open',
  'wslview',
  'explorer.exe',
  'cmd.exe',
  'powershell.exe',
  'open',
] as const;

const TERMINAL_WRAPPER = 'script';
const OPENER_STUBS_DIRECTORY = 'arc-agent-auth-openers';
const KILL_ESCALATION_MS = 3_000;
const MAX_REASON_CHARS = 200;

type ActiveLogin = {
  readonly parser: LoginOutputParser;
  readonly listeners: Set<AgentLoginListener>;
  lastLink: AgentLoginEvent | undefined;
  lastPrompt: AgentLoginEvent | undefined;
  readonly confirmAnswer: string | undefined;
  child: ChildProcess | undefined;
  cancelled: boolean;
  timedOut: boolean;
  done: Promise<void>;
};

@Injectable()
export class CliAgentAuthAdapter implements IAgentAuthPort, OnModuleDestroy {
  private readonly logger = new Logger(CliAgentAuthAdapter.name);
  private readonly logins = new Map<string, ActiveLogin>();
  private openerStubs: Promise<string> | undefined;

  constructor(
    @Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory,
    @Inject(IProcessRunnerPort) private readonly processRunner: IProcessRunnerPort,
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    private readonly config: AgentAuthConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.isEnabled();
  }

  onModuleDestroy(): void {
    for (const agentId of [...this.logins.keys()]) {
      this.cancelLogin(agentId);
    }
  }

  async listAuthInfo(): Promise<readonly AgentAuthInfo[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const agents = this.agentPortFactory
      .listAvailableAgents()
      .filter(agent => this.findProvider(agent.agentId));
    const infos = await Promise.all(agents.map(agent => this.getStatus(agent.agentId)));
    return infos.filter((info): info is AgentAuthInfo => info !== undefined);
  }

  async getStatus(agentId: string): Promise<AgentAuthInfo | undefined> {
    const provider = this.findProvider(agentId);
    const agent = this.agentPortFactory.listAvailableAgents().find(candidate => candidate.agentId === agentId);
    if (!provider || !agent) {
      return undefined;
    }
    const { status, detail } = await this.probeStatus(provider);
    return { agentId, displayName: agent.displayName, status, ...(detail ? { detail } : {}) };
  }

  startLogin(agentId: string, listener: AgentLoginListener): AgentLoginSubscription {
    if (!this.isEnabled()) {
      throw new Error('Agent authentication is disabled.');
    }
    const existing = this.logins.get(agentId);
    if (existing) {
      return this.join(existing, listener);
    }
    const provider = this.findProvider(agentId);
    if (!provider) {
      throw new Error(`Agent "${agentId}" has no CLI login.`);
    }
    const binary = provider.login.binaries.find(candidate => this.fileSystem.isInPath(candidate));
    if (!binary) {
      throw new Error(`The ${agentId} CLI was not found in PATH.`);
    }

    const login: ActiveLogin = {
      parser: new LoginOutputParser(),
      listeners: new Set(),
      lastLink: undefined,
      lastPrompt: undefined,
      confirmAnswer: provider.login.confirmAnswer,
      child: undefined,
      cancelled: false,
      timedOut: false,
      done: Promise.resolve(),
    };
    this.logins.set(agentId, login);
    const subscription = this.join(login, listener);
    login.done = this.run(agentId, provider, binary, login);
    return subscription;
  }

  submitInput(agentId: string, text: string): boolean {
    const stdin = this.logins.get(agentId)?.child?.stdin;
    if (!stdin?.writable) {
      return false;
    }
    stdin.write(`${text}\n`);
    return true;
  }

  cancelLogin(agentId: string): void {
    const login = this.logins.get(agentId);
    if (!login) {
      return;
    }
    login.cancelled = true;
    this.terminate(login);
  }

  private join(login: ActiveLogin, listener: AgentLoginListener): AgentLoginSubscription {
    login.listeners.add(listener);
    for (const event of [login.lastLink, login.lastPrompt]) {
      if (event) {
        listener(event);
      }
    }
    return {
      unsubscribe: () => login.listeners.delete(listener),
      // Read on access: `run` only assigns the promise after the first subscription was created.
      get done() {
        return login.done;
      },
    };
  }

  private findProvider(agentId: string): AgentAuthProvider | undefined {
    return AGENT_AUTH_PROVIDERS.find(provider => provider.agentId === agentId);
  }

  private async run(
    agentId: string,
    provider: AgentAuthProvider,
    binary: string,
    login: ActiveLogin,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: AgentLoginEvent;
    try {
      const openers = await this.ensureOpenerStubs();
      if (login.cancelled) {
        outcome = { kind: 'cancelled' };
      } else {
        const child = this.spawnLogin(binary, provider.login, openers);
        login.child = child;
        timer = setTimeout(() => {
          login.timedOut = true;
          this.terminate(login);
        }, this.config.getLoginTimeoutMs());
        outcome = await this.waitForExit(agentId, login, child);
      }
    } catch (error) {
      outcome = { kind: 'failed', reason: `Could not start the ${agentId} login.` };
      this.logger.warn(`login_failed: agent=${agentId} reason=${String(error)}`);
    } finally {
      clearTimeout(timer);
      this.logins.delete(agentId);
    }
    this.logger.log(`login_finished: agent=${agentId} outcome=${outcome.kind}`);
    for (const listener of login.listeners) {
      listener(outcome);
    }
  }

  private spawnLogin(binary: string, login: AgentAuthProvider['login'], openers: string): ChildProcess {
    const cwd = tmpdir();
    const env = buildAgentProcessEnv(cwd);
    env.PATH = [openers, env.PATH].filter(Boolean).join(delimiter);
    env.BROWSER = this.fileSystem.joinPath(openers, 'xdg-open');
    env.NO_OPEN_BROWSER = '1';
    const [command, args] = login.terminal && this.fileSystem.isInPath(TERMINAL_WRAPPER)
      ? this.inTerminal(binary, login.args)
      : [binary, login.args];
    return this.processRunner.spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
  }

  /** `script` runs the command under a pseudo-terminal, which some CLIs need before they ask a question. */
  private inTerminal(binary: string, args: readonly string[]): [string, readonly string[]] {
    const quoted = [binary, ...args].map(word => `'${word.replaceAll('\'', `'\\''`)}'`).join(' ');
    return [TERMINAL_WRAPPER, ['-qfec', quoted, '/dev/null']];
  }

  private waitForExit(agentId: string, login: ActiveLogin, child: ChildProcess): Promise<AgentLoginEvent> {
    return new Promise((resolve) => {
      const onOutput = (chunk: Buffer): void => {
        for (const output of login.parser.feed(chunk.toString('utf8'))) {
          if (output.kind === 'question' && login.confirmAnswer !== undefined) {
            child.stdin?.write(`${login.confirmAnswer}\n`);
            this.logger.log(`login_question_answered: agent=${agentId}`);
            continue;
          }
          const event: AgentLoginEvent = output.kind === 'question'
            ? { kind: 'prompt', hint: output.question }
            : output;
          if (event.kind === 'prompt') {
            login.lastPrompt = event;
          } else {
            login.lastLink = event;
          }
          for (const listener of login.listeners) {
            listener(event);
          }
        }
      };
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.once('error', (error) => {
        this.logger.warn(`login_spawn_error: agent=${agentId} reason=${error.message}`);
        resolve({ kind: 'failed', reason: `Could not start the ${agentId} CLI.` });
      });
      child.once('close', (code) => {
        void this.settle(agentId, login, code).then(resolve);
      });
    });
  }

  private async settle(agentId: string, login: ActiveLogin, code: number | null): Promise<AgentLoginEvent> {
    if (login.cancelled) {
      return { kind: 'cancelled' };
    }
    if (login.timedOut) {
      return { kind: 'failed', reason: 'The login timed out.' };
    }
    if (code !== 0) {
      const message = login.parser.lastMessage()?.slice(0, MAX_REASON_CHARS);
      return { kind: 'failed', reason: message ?? `The login exited with code ${String(code)}.` };
    }
    const info = await this.getStatus(agentId);
    return info?.status === 'unauthenticated'
      ? { kind: 'failed', reason: 'The login finished but the CLI still reports no login.' }
      : { kind: 'completed' };
  }

  private terminate(login: ActiveLogin): void {
    const child = login.child;
    if (!child) {
      return;
    }
    child.kill('SIGTERM');
    const escalation = setTimeout(() => child.kill('SIGKILL'), KILL_ESCALATION_MS);
    escalation.unref();
    child.once('close', () => clearTimeout(escalation));
  }

  private ensureOpenerStubs(): Promise<string> {
    this.openerStubs ??= this.writeOpenerStubs();
    return this.openerStubs;
  }

  private async writeOpenerStubs(): Promise<string> {
    const directory = this.fileSystem.joinPath(tmpdir(), OPENER_STUBS_DIRECTORY);
    await Promise.all(
      BROWSER_OPENERS.map(name =>
        this.fileSystem.writeExecutable(this.fileSystem.joinPath(directory, name), '#!/bin/sh\nexit 0\n')),
    );
    return directory;
  }

  private async probeStatus(provider: AgentAuthProvider): Promise<AgentStatusParse> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.getStatusTimeoutMs());
    try {
      return provider.status.kind === 'command'
        ? await this.probeCommand(provider.status, abort.signal)
        : await this.probeAcp(provider.agentId, abort.signal);
    } catch (error) {
      this.logger.warn(`status_failed: agent=${provider.agentId} reason=${String(error)}`);
      return { status: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeCommand(
    probe: Extract<AgentAuthProvider['status'], { kind: 'command' }>,
    signal: AbortSignal,
  ): Promise<AgentStatusParse> {
    const binary = probe.binaries.find(candidate => this.fileSystem.isInPath(candidate));
    if (!binary) {
      return { status: 'unknown' };
    }
    const { exitCode, output } = await this.processRunner.run(binary, probe.args, { signal });
    return probe.parse(output, exitCode);
  }

  private async probeAcp(agentId: string, signal: AbortSignal): Promise<AgentStatusParse> {
    const port = this.agentPortFactory.create(agentId);
    try {
      await this.raceAbort(this.openSession(port), signal);
      return { status: 'authenticated' };
    } catch (error) {
      return { status: error instanceof AgentAuthRequiredError ? 'unauthenticated' : 'unknown' };
    } finally {
      await port.closeSession().catch(() => undefined);
      await port.disconnect().catch(() => undefined);
    }
  }

  private async openSession(port: IAgentPort): Promise<void> {
    await port.connect();
    await port.createSession(tmpdir());
  }

  private raceAbort(work: Promise<void>, signal: AbortSignal): Promise<void> {
    // The work may still reject after the race was lost and the port disconnected.
    work.catch(() => undefined);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('The status probe timed out.')), { once: true });
      work.then(resolve, reject);
    });
  }
}
