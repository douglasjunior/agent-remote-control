import { EventEmitter } from 'node:events';
import { vi, type Mock } from 'vitest';

import type { IProcessRunnerPort } from '../ports/process-runner.port.js';


export type ChildProcessLike = EventEmitter & {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

type ConnectionMethodMock = Mock<(params?: unknown) => Promise<unknown>>;

export type ConnectionMock = {
  initialize: ConnectionMethodMock;
  newSession: ConnectionMethodMock;
  prompt: ConnectionMethodMock;
  steer: ConnectionMethodMock;
  cancel: ConnectionMethodMock;
  closeSession: ConnectionMethodMock;
  setSessionConfigOption: ConnectionMethodMock;
};

type LastClient = {
  sessionUpdate: (notification: unknown) => Promise<unknown>;
  requestPermission: (params: {
    options: { optionId: string; kind?: string }[];
  }) => Promise<unknown>;
  extensionRequest: (method: string, params?: unknown) => Promise<unknown>;
  extensionMethods: readonly string[];
};

type ExtensionHandler = {
  parse: (params: unknown) => unknown;
  handle: (ctx: { params: unknown }) => unknown;
};

export type ActiveSessionMock = {
  sessionId: string;
  newSessionResponse: { sessionId: string; configOptions?: unknown[] };
  prompt: (text: string) => Promise<unknown>;
  nextUpdate: () => Promise<unknown>;
  dispose: () => void;
  enqueueUpdate: (notification: unknown) => void;
};

export const acpHarness: {
  spawnedProcs: ChildProcessLike[];
  connectionInstance: ConnectionMock | null;
  lastClient: LastClient | null;
  activeSession: ActiveSessionMock | null;
  pendingConnectionOverrides: Partial<ConnectionMock> | null;
} = {
  spawnedProcs: [],
  connectionInstance: null,
  lastClient: null,
  activeSession: null,
  pendingConnectionOverrides: null,
};

export function resetAcpHarness(): void {
  acpHarness.spawnedProcs = [];
  acpHarness.connectionInstance = null;
  acpHarness.lastClient = null;
  acpHarness.activeSession = null;
  acpHarness.pendingConnectionOverrides = null;
}

function makeSpawnedProc(): ChildProcessLike {
  const proc = new EventEmitter() as unknown as ChildProcessLike;
  proc.stdin = new EventEmitter() as unknown as NodeJS.WritableStream;
  proc.stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  acpHarness.spawnedProcs.push(proc);
  return proc;
}

export function childProcessMockModule() {
  return {
    spawn: vi.fn(() => makeSpawnedProc()),
  };
}

export function createProcessRunnerMock(): {
  runner: IProcessRunnerPort;
  spawn: Mock<
    (
      command: string,
      args: readonly string[],
      options?: unknown,
    ) => ChildProcessLike
  >;
} {
  const spawn = vi.fn(
    (_command: string, _args: readonly string[], _options?: unknown) =>
      makeSpawnedProc(),
  );
  const runner = {
    run: vi.fn(),
    runInteractive: vi.fn(),
    spawn,
    reexec: vi.fn(),
  } as unknown as IProcessRunnerPort;
  return { runner, spawn };
}

export function streamMockModule() {
  return {
    Readable: { toWeb: vi.fn(() => ({ kind: 'readable-web' })) },
    Writable: { toWeb: vi.fn(() => ({ kind: 'writable-web' })) },
  };
}

class HarnessUpdateQueue {
  private readonly values: (
    { ok: true; value: unknown } | { ok: false; error: unknown }
  )[] = [];

  private readonly waiters: {
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }[] = [];

  private failed = false;
  private failure: unknown;

  enqueue(value: unknown): void {
    if (this.failed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(value);
    else this.values.push({ ok: true, value });
  }

  reject(error: unknown): void {
    if (this.failed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.reject(error);
    else this.values.push({ ok: false, error });
  }

  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<unknown> {
    const entry = this.values.shift();
    if (entry)
      return entry.ok
        ? Promise.resolve(entry.value)
        : Promise.reject(entry.error);
    if (this.failed) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

function createActiveSessionMock(
  instance: ConnectionMock,
  response: { sessionId: string; configOptions?: unknown[] },
): ActiveSessionMock {
  const queue = new HarnessUpdateQueue();
  return {
    sessionId: response.sessionId,
    newSessionResponse: response,
    prompt: (text: string) => {
      const promise = instance.prompt({
        sessionId: response.sessionId,
        prompt: [{ type: 'text', text }],
      });
      void Promise.resolve(promise).then(
        value =>
          queue.enqueue({
            kind: 'stop',
            response: value,
            stopReason: (value as { stopReason?: string } | undefined)
              ?.stopReason,
          }),
        (error: unknown) => queue.reject(error),
      );
      return promise;
    },
    nextUpdate: () => queue.next(),
    dispose: () => queue.fail(new Error('Active session disposed')),
    enqueueUpdate: (notification: unknown) =>
      queue.enqueue({
        kind: 'session_update',
        notification,
        update: (notification as { update?: unknown }).update,
      }),
  };
}

export function acpSdkMockModule() {
  function client() {
    const instance: ConnectionMock = {
      initialize: vi.fn(async () => undefined),
      newSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      prompt: vi.fn(async () => undefined),
      steer: vi.fn(async () => ({ outcome: 'injected' })),
      cancel: vi.fn(async () => undefined),
      closeSession: vi.fn(async () => undefined),
      setSessionConfigOption: vi.fn(async () => ({ configOptions: [] })),
    };

    const handlers: {
      sessionUpdate?: (ctx: { params: unknown }) => unknown;
      requestPermission?: (ctx: { params: unknown }) => unknown;
      extensions: Map<string, ExtensionHandler>;
    } = { extensions: new Map() };

    const app = {
      onNotification(
        method: string,
        handler: (ctx: { params: unknown }) => unknown,
      ) {
        if (method === 'session/update') handlers.sessionUpdate = handler;
        return app;
      },
      onRequest(
        method: string,
        parserOrHandler: unknown,
        extensionHandler?: (ctx: { params: unknown }) => unknown,
      ) {
        if (extensionHandler) {
          const parser = parserOrHandler as
            | { parse: (params: unknown) => unknown }
            | ((params: unknown) => unknown);
          handlers.extensions.set(method, {
            parse:
              typeof parser === 'function'
                ? parser
                : params => parser.parse(params),
            handle: extensionHandler,
          });
          return app;
        }
        if (method === 'session/request_permission') {
          handlers.requestPermission = parserOrHandler as (ctx: {
            params: unknown;
          }) => unknown;
        }
        return app;
      },
      connect() {
        if (acpHarness.pendingConnectionOverrides) {
          Object.assign(instance, acpHarness.pendingConnectionOverrides);
          acpHarness.pendingConnectionOverrides = null;
        }
        acpHarness.connectionInstance = instance;
        acpHarness.lastClient = {
          sessionUpdate: (notification: unknown) => {
            const handled = handlers.sessionUpdate?.({ params: notification });
            acpHarness.activeSession?.enqueueUpdate(notification);
            return Promise.resolve(handled);
          },
          requestPermission: (params: {
            options: { optionId: string; kind?: string }[];
          }) => Promise.resolve(handlers.requestPermission?.({ params })),
          extensionRequest: (method: string, params?: unknown) => {
            const handler = handlers.extensions.get(method);
            if (!handler) {
              return Promise.reject(
                new Error(`No extension handler registered for: ${method}`),
              );
            }
            return Promise.resolve(
              handler.handle({ params: handler.parse(params) }),
            );
          },
          extensionMethods: [...handlers.extensions.keys()],
        };
        return {
          agent: {
            request: (method: string, params: unknown) => {
              switch (method) {
                case 'initialize':
                  return instance.initialize(params);
                case 'session/new':
                  return instance.newSession(params);
                case 'session/prompt':
                  return instance.prompt(params);
                case '_session/steering':
                  return instance.steer(params);
                case 'session/close':
                  return instance.closeSession(params);
                case 'session/set_config_option':
                  return instance.setSessionConfigOption(params);
                default:
                  throw new Error(`Unexpected agent.request method: ${method}`);
              }
            },
            notify: (method: string, params: unknown) => {
              if (method === 'session/cancel') return instance.cancel(params);
              throw new Error(`Unexpected agent.notify method: ${method}`);
            },
            buildSession: (request: unknown) => ({
              start: async () => {
                const response = (await instance.newSession(request)) as {
                  sessionId: string;
                  configOptions?: unknown[];
                };
                const session = createActiveSessionMock(instance, response);
                acpHarness.activeSession = session;
                return session;
              },
            }),
          },
          signal: new AbortController().signal,
          closed: Promise.resolve(),
          close: vi.fn(),
        };
      },
    };
    return app;
  }

  return {
    PROTOCOL_VERSION: 'mock-protocol-version',
    ndJsonStream: vi.fn(() => ({ kind: 'nd-json-stream' })),
    client,
  };
}

type SelectOption = { value: string; name: string; description?: string };

export function modelConfigOption(opts: {
  currentValue: string;
  options: SelectOption[];
}) {
  return {
    id: 'model',
    type: 'select' as const,
    name: 'Model',
    category: 'model',
    currentValue: opts.currentValue,
    options: opts.options.map(o => ({
      value: o.value,
      name: o.name,
      description: o.description,
    })),
  };
}

export function effortConfigOption(opts: {
  currentValue: string;
  options: SelectOption[];
}) {
  return {
    id: 'thought_level',
    type: 'select' as const,
    name: 'Thought level',
    category: 'thought_level',
    currentValue: opts.currentValue,
    options: opts.options.map(o => ({
      value: o.value,
      name: o.name,
      description: o.description,
    })),
  };
}

export function permissionsConfigOption(opts: {
  currentValue: string;
  options: SelectOption[];
}) {
  return {
    id: 'allow_all',
    type: 'select' as const,
    name: 'Allow all',
    category: 'permissions',
    currentValue: opts.currentValue,
    options: opts.options.map(o => ({
      value: o.value,
      name: o.name,
      description: o.description,
    })),
  };
}

export function messageChunk(text: string, messageId?: string) {
  return {
    sessionId: 'session-1',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId,
    },
  };
}
