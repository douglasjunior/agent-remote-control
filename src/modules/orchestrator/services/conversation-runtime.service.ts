import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import { ActiveTurn } from '../models/active-turn.model.js';


const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type ConversationRuntime = {
  readonly agentPort: IAgentPort;
  tail: Promise<void>;
  pendingTurns: number;
  activeTurn: ActiveTurn | null;
  idleTimer: NodeJS.Timeout | null;
};

@Injectable()
export class ConversationRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationRuntimeService.name);
  private readonly runtimes = new Map<string, ConversationRuntime>();
  private readonly idleTimeoutMs: number;

  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
    @Optional() idleTimeoutMs?: number,
  ) {
    this.idleTimeoutMs =
      idleTimeoutMs
      ?? (Number(process.env.SESSION_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT_MS);
  }

  run<T>(
    conversationKey: string,
    work: (agentPort: IAgentPort, turn: ActiveTurn) => Promise<T>,
    onQueued?: () => void,
  ): Promise<T> {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);

    if (runtime.pendingTurns > 0) {
      this.logger.log(`[Turn Queued] Conversation=${conversationKey}, Ahead=${runtime.pendingTurns}`);
      onQueued?.();
    }
    runtime.pendingTurns++;

    const result = runtime.tail.then(async () => {
      const turn = new ActiveTurn(runtime.agentPort);
      runtime.activeTurn = turn;
      try {
        return await work(runtime.agentPort, turn);
      } finally {
        runtime.activeTurn = null;
        runtime.pendingTurns--;
        if (runtime.pendingTurns === 0) {
          this.scheduleExpiration(conversationKey, runtime);
        }
      }
    });
    runtime.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async cancel(conversationKey: string): Promise<boolean> {
    const turn = this.runtimes.get(conversationKey)?.activeTurn;
    if (!turn) {
      return false;
    }
    await turn.cancel();
    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    const runtimes = Array.from(this.runtimes.values());
    this.runtimes.clear();
    await Promise.all(runtimes.map(async (runtime) => {
      this.clearIdleTimer(runtime);
      await runtime.agentPort.disconnect().catch(() => undefined);
    }));
  }

  private getOrCreate(conversationKey: string): ConversationRuntime {
    let runtime = this.runtimes.get(conversationKey);
    if (!runtime) {
      runtime = {
        agentPort: this.agentPortFactory.create(),
        tail: Promise.resolve(),
        pendingTurns: 0,
        activeTurn: null,
        idleTimer: null,
      };
      this.runtimes.set(conversationKey, runtime);
    }
    return runtime;
  }

  private scheduleExpiration(conversationKey: string, runtime: ConversationRuntime): void {
    runtime.idleTimer = setTimeout(() => {
      void this.expire(conversationKey, runtime);
    }, this.idleTimeoutMs);
    runtime.idleTimer.unref();
  }

  private clearIdleTimer(runtime: ConversationRuntime): void {
    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }
  }

  private async expire(conversationKey: string, runtime: ConversationRuntime): Promise<void> {
    runtime.idleTimer = null;
    this.runtimes.delete(conversationKey);
    this.logger.log(`[Session Expired] Conversation=${conversationKey} idle for ${this.idleTimeoutMs}ms`);
    await runtime.agentPort.closeSession().catch(() => undefined);
    await runtime.agentPort.disconnect().catch(() => undefined);
  }
}
