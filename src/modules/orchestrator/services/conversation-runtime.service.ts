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
  agentPort: IAgentPort | null;
  tail: Promise<void>;
  pendingTurns: number;
  activeTurnsCount: number;
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
    agentId: string,
    work: (agentPort: IAgentPort, turn: ActiveTurn) => Promise<T>,
    onQueued?: () => void,
  ): Promise<T> {
    const endTurn = this.beginTurn(conversationKey);
    return this.runOnCeo(conversationKey, agentId, work, onQueued).finally(endTurn);
  }

  /**
   * The CEO port is resolved inside the queue: switching agents disposes the previous port only
   * after the turns already using it have finished.
   */
  runOnCeo<T>(
    conversationKey: string,
    agentId: string,
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
      try {
        const agentPort = await this.ensureCeoPort(conversationKey, runtime, agentId);
        const turn = new ActiveTurn(agentPort);
        runtime.activeTurn = turn;
        return await work(agentPort, turn);
      } finally {
        runtime.activeTurn = null;
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

  /**
   * Injects the text into the CEO round in progress when it runs on `agentId` with steering and no
   * other turn is waiting, since a queued turn must reach the CEO first.
   */
  async steerCeo(conversationKey: string, agentId: string, text: string): Promise<boolean> {
    const runtime = this.runtimes.get(conversationKey);
    const agentPort = runtime?.agentPort;
    if (
      !runtime?.activeTurn
      || runtime.activeTurn.isCancelled
      || runtime.pendingTurns !== 1
      || agentPort?.agentName !== agentId
      || !agentPort.supportsSteering
    ) {
      return false;
    }
    return agentPort.sendSteeringPrompt(text);
  }

  getCeoPort(conversationKey: string): IAgentPort | undefined {
    return this.runtimes.get(conversationKey)?.agentPort ?? undefined;
  }

  registerDelegation(conversationKey: string, delegation: ActiveDelegation): void {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);
    runtime.activeDelegations.set(delegation.role.toUpperCase(), delegation);
  }

  unregisterDelegation(conversationKey: string, role: string, delegation?: ActiveDelegation): void {
    const runtime = this.runtimes.get(conversationKey);
    if (!runtime) return;
    const roleKey = role.toUpperCase();
    if (delegation) {
      const current = runtime.activeDelegations.get(roleKey);
      if (current !== delegation) {
        return;
      }
    }
    runtime.activeDelegations.delete(roleKey);
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
    const cancelPromises: Promise<void>[] = [];
    if (runtime.activeTurn) {
      cancelPromises.push(runtime.activeTurn.cancel());
    }
    for (const delegation of runtime.activeDelegations.values()) {
      cancelPromises.push(delegation.turn.cancel());
    }
    if (cancelPromises.length === 0) {
      return false;
    }
    const results = await Promise.allSettled(cancelPromises);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) {
      throw rejected.reason;
    }
    return true;
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
      await runtime.agentPort?.disconnect().catch(() => undefined);
    }));
  }

  private getOrCreate(conversationKey: string): ConversationRuntime {
    let runtime = this.runtimes.get(conversationKey);
    if (!runtime) {
      runtime = {
        agentPort: null,
        tail: Promise.resolve(),
        pendingTurns: 0,
        activeTurnsCount: 0,
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
    await runtime.agentPort?.closeSession().catch(() => undefined);
    await runtime.agentPort?.disconnect().catch(() => undefined);
  }

  private async ensureCeoPort(
    conversationKey: string,
    runtime: ConversationRuntime,
    agentId: string,
  ): Promise<IAgentPort> {
    const current = runtime.agentPort;
    if (current?.agentName === agentId) {
      return current;
    }

    if (current) {
      this.logger.log(`[CEO Agent Switched] Conversation=${conversationKey}, From=${current.agentName}, To=${agentId}`);
      runtime.agentPort = null;
      await current.closeSession().catch(() => undefined);
      await current.disconnect().catch(() => undefined);
    }

    const agentPort = this.agentPortFactory.create(agentId);
    runtime.agentPort = agentPort;
    return agentPort;
  }
}
