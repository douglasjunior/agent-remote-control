import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';


const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type ConversationRuntime = {
  readonly agentPort: IAgentPort;
  tail: Promise<void>;
  pendingTurns: number;
  activeTurnsCount: number;
  isCeoBusy: boolean;
  activeTurn: ActiveTurn | null;
  activeDelegations: Map<string, ActiveDelegation>;
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
    const endTurn = this.beginTurn(conversationKey);
    return this.runOnCeo(conversationKey, work, onQueued).finally(endTurn);
  }

  runOnCeo<T>(
    conversationKey: string,
    work: (agentPort: IAgentPort, turn: ActiveTurn) => Promise<T>,
    onQueued?: () => void,
  ): Promise<T> {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);

    if (runtime.pendingTurns > 0) {
      this.logger.log(`[CEO Turn Queued] Conversation=${conversationKey}, Ahead=${runtime.pendingTurns}`);
      onQueued?.();
    }
    runtime.pendingTurns++;

    const result = runtime.tail.then(async () => {
      runtime.isCeoBusy = true;
      const turn = new ActiveTurn(runtime.agentPort);
      runtime.activeTurn = turn;
      try {
        return await work(runtime.agentPort, turn);
      } finally {
        runtime.activeTurn = null;
        runtime.isCeoBusy = false;
        runtime.pendingTurns--;
        if (runtime.pendingTurns === 0 && runtime.activeTurnsCount === 0 && runtime.activeDelegations.size === 0) {
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

  beginTurn(conversationKey: string): () => void {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);
    runtime.activeTurnsCount++;
    return () => {
      runtime.activeTurnsCount--;
      if (runtime.pendingTurns === 0 && runtime.activeTurnsCount === 0 && runtime.activeDelegations.size === 0) {
        this.scheduleExpiration(conversationKey, runtime);
      }
    };
  }

  getCeoPort(conversationKey: string): IAgentPort {
    return this.getOrCreate(conversationKey).agentPort;
  }

  registerDelegation(conversationKey: string, delegation: ActiveDelegation): void {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);
    runtime.activeDelegations.set(delegation.role.toUpperCase(), delegation);
  }

  unregisterDelegation(conversationKey: string, role: string): void {
    const runtime = this.runtimes.get(conversationKey);
    if (!runtime) return;
    runtime.activeDelegations.delete(role.toUpperCase());
    if (runtime.pendingTurns === 0 && runtime.activeTurnsCount === 0 && runtime.activeDelegations.size === 0) {
      this.scheduleExpiration(conversationKey, runtime);
    }
  }

  getActiveDelegations(conversationKey: string): readonly ActiveDelegation[] {
    const runtime = this.runtimes.get(conversationKey);
    return runtime ? Array.from(runtime.activeDelegations.values()) : [];
  }

  findActiveDelegation(conversationKey: string, role: string): ActiveDelegation | undefined {
    return this.runtimes.get(conversationKey)?.activeDelegations.get(role.toUpperCase());
  }

  async cancel(conversationKey: string): Promise<boolean> {
    const runtime = this.runtimes.get(conversationKey);
    if (!runtime) {
      return false;
    }
    let hadWork = false;
    if (runtime.activeTurn) {
      hadWork = true;
      await runtime.activeTurn.cancel();
    }
    if (runtime.activeDelegations.size > 0) {
      hadWork = true;
      for (const delegation of Array.from(runtime.activeDelegations.values())) {
        await delegation.turn.cancel();
      }
    }
    return hadWork;
  }

  async onApplicationShutdown(): Promise<void> {
    const runtimes = Array.from(this.runtimes.values());
    this.runtimes.clear();
    await Promise.all(runtimes.map(async (runtime) => {
      this.clearIdleTimer(runtime);
      for (const delegation of runtime.activeDelegations.values()) {
        await delegation.agentPort.disconnect().catch(() => undefined);
      }
      runtime.activeDelegations.clear();
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
        activeTurnsCount: 0,
        isCeoBusy: false,
        activeTurn: null,
        activeDelegations: new Map(),
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
    for (const delegation of runtime.activeDelegations.values()) {
      await delegation.agentPort.closeSession().catch(() => undefined);
      await delegation.agentPort.disconnect().catch(() => undefined);
    }
    runtime.activeDelegations.clear();
    await runtime.agentPort.closeSession().catch(() => undefined);
    await runtime.agentPort.disconnect().catch(() => undefined);
  }
}
