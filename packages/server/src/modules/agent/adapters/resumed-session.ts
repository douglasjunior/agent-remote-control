import type {
  ActiveSessionMessage,
  ClientConnection,
  PromptResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';


export type SessionHandle = {
  readonly sessionId: string;
  prompt(text: string): Promise<PromptResponse>;
  nextUpdate(): Promise<ActiveSessionMessage>;
  dispose(): void;
};

type QueuedMessage =
  | { readonly ok: true; readonly message: ActiveSessionMessage }
  | { readonly ok: false; readonly error: unknown };

type MessageWaiter = {
  readonly resolve: (message: ActiveSessionMessage) => void;
  readonly reject: (error: unknown) => void;
};

// The SDK builds ActiveSession only for session/new (attachSession is private), so a loaded
// session gets its own handle fed by the global session/update handler. It is created only
// after the session/load response, which discards the history replayed before it.
export class ResumedSession implements SessionHandle {
  private readonly queued: QueuedMessage[] = [];
  private readonly waiters: MessageWaiter[] = [];
  private failure: Error | null = null;

  constructor(
    readonly sessionId: string,
    private readonly connection: ClientConnection,
  ) {}

  route(notification: SessionNotification): void {
    if (notification.sessionId !== this.sessionId) {
      return;
    }
    this.settle({ ok: true, message: { kind: 'session_update', notification, update: notification.update } });
  }

  prompt(text: string): Promise<PromptResponse> {
    const response = this.connection.agent.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
    void response.then(
      value => this.settle({ ok: true, message: { kind: 'stop', response: value, stopReason: value.stopReason } }),
      (error: unknown) => this.settle({ ok: false, error }),
    );
    return response;
  }

  nextUpdate(): Promise<ActiveSessionMessage> {
    const entry = this.queued.shift();
    if (entry) {
      return entry.ok ? Promise.resolve(entry.message) : Promise.reject(entry.error);
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  dispose(): void {
    this.failure = new Error('Resumed session disposed');
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(this.failure);
    }
  }

  private settle(entry: QueuedMessage): void {
    if (this.failure) {
      return;
    }
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.queued.push(entry);
      return;
    }
    if (entry.ok) {
      waiter.resolve(entry.message);
    } else {
      waiter.reject(entry.error);
    }
  }
}
