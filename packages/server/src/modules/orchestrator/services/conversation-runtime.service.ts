import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentReceipt } from '../models/agent-receipt.model.js';
import { ConversationTurn } from '../models/conversation-turn.model.js';

import { AgentToolSessionsService } from './agent-tool-sessions.service.js';


type ConversationRuntime = {
  agentPort: IAgentPort | null;
  /** The one turn the conversation runs at a time. */
  turn: ConversationTurn | null;
  /** Turns that resume interrupted work, waiting for the running one to end; `undefined` when a stop cancels the wait. */
  waiters: ((turn: ConversationTurn | undefined) => void)[];
  activeDelegations: Map<string, ActiveDelegation>;
  idleTimer: NodeJS.Timeout | null;
};

/** A message either starts the conversation's turn or joins the one running. */
export type TurnAdmission = { readonly kind: 'drive' | 'join'; readonly turn: ConversationTurn };

@Injectable()
export class ConversationRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationRuntimeService.name);
  private readonly runtimes = new Map<string, ConversationRuntime>();
  /** Outlive the runtime, which expires while the conversation is idle and the notices wait for its next message. */
  private readonly ceoNotices = new Map<string, string[]>();
  /** `<agent_result>` receipts that wait for the CEO's next prompt, since they start no round of their own. */
  private readonly agentReceipts = new Map<string, AgentReceipt[]>();
  private receiptsAdded = 0;

  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
    private readonly toolSessions: AgentToolSessionsService,
    @Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort,
  ) {}

  admit(conversationKey: string): TurnAdmission {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);
    if (runtime.turn) {
      return { kind: 'join', turn: runtime.turn };
    }
    runtime.turn = new ConversationTurn();
    return { kind: 'drive', turn: runtime.turn };
  }

  /** The turn of work a restart interrupted, once the running turn ends; `undefined` when a stop cancels the wait. */
  acquire(conversationKey: string): Promise<ConversationTurn | undefined> {
    const admission = this.admit(conversationKey);
    if (admission.kind === 'drive') {
      return Promise.resolve(admission.turn);
    }
    this.logger.log(`[Turn Waiting] Conversation=${conversationKey}`);
    return new Promise(resolve => this.runtimes.get(conversationKey)!.waiters.push(resolve));
  }

  /**
   * Ends the turn. The messages still in its inbox start the next turn, the first one as its prompt and the others
   * read with it; with none, a turn waiting to resume work starts.
   */
  endTurn(conversationKey: string, turn: ConversationTurn): void {
    const runtime = this.runtimes.get(conversationKey);
    if (runtime?.turn !== turn) {
      return;
    }
    const [driver, ...others] = turn.take();
    if (driver) {
      this.logger.log(`[Turn Handed Over] Conversation=${conversationKey}, Messages=${others.length + 1}`);
      runtime.turn = new ConversationTurn(others);
      driver.drive(runtime.turn);
      return;
    }
    const waiter = runtime.waiters.shift();
    if (waiter) {
      runtime.turn = new ConversationTurn();
      waiter(runtime.turn);
      return;
    }
    runtime.turn = null;
    this.expireWhenIdle(conversationKey, runtime);
  }

  /**
   * Runs `work` on the CEO port, resolved here: switching agents disposes the previous port, which only the running turn
   * can be using.
   */
  async runOnCeo<T>(
    conversationKey: string,
    turn: ConversationTurn,
    agentId: string,
    work: (agentPort: IAgentPort, ceo: ActiveTurn) => Promise<T>,
  ): Promise<T> {
    turn.throwIfCancelled();
    const agentPort = await this.ensureCeoPort(conversationKey, this.getOrCreate(conversationKey), agentId);
    turn.throwIfCancelled();
    turn.ceo = new ActiveTurn(agentPort);
    try {
      return await work(agentPort, turn.ceo);
    } finally {
      turn.ceo = null;
    }
  }

  /** Whether a message can be steered into the turn's CEO prompt on its way: one running on `agentId`, which takes steering. */
  acceptsSteering(conversationKey: string, turn: ConversationTurn, agentId: string): boolean {
    const agentPort = this.runtimes.get(conversationKey)?.agentPort;
    return turn.prompting && !turn.isCancelled && agentPort?.agentName === agentId && agentPort.supportsSteering;
  }

  /** Injects the text into the turn's CEO prompt running, when it still accepts steering. */
  async steerCeo(conversationKey: string, turn: ConversationTurn, agentId: string, text: string): Promise<boolean> {
    if (!this.acceptsSteering(conversationKey, turn, agentId)) {
      return false;
    }
    return (await this.runtimes.get(conversationKey)!.agentPort!.sendSteeringPrompt(text)) === 'injected';
  }

  getCeoPort(conversationKey: string): IAgentPort | undefined {
    return this.runtimes.get(conversationKey)?.agentPort ?? undefined;
  }

  addCeoNotice(conversationKey: string, notice: string): void {
    this.ceoNotices.set(conversationKey, [...this.pendingCeoNotices(conversationKey), notice]);
  }

  pendingCeoNotices(conversationKey: string): readonly string[] {
    return this.ceoNotices.get(conversationKey) ?? [];
  }

  /** Drops only the first `count`, so a notice added while the CEO was reading the others stays pending. */
  acknowledgeCeoNotices(conversationKey: string, count: number): void {
    const remaining = this.pendingCeoNotices(conversationKey).slice(count);
    if (remaining.length > 0) {
      this.ceoNotices.set(conversationKey, remaining);
    } else {
      this.ceoNotices.delete(conversationKey);
    }
  }

  addAgentReceipt(conversationKey: string, receipt: string): void {
    this.agentReceipts.set(conversationKey, [...this.agentReceipts.get(conversationKey) ?? [], { order: this.receiptsAdded++, text: receipt }]);
  }

  pendingAgentReceipts(conversationKey: string): readonly string[] {
    return (this.agentReceipts.get(conversationKey) ?? []).map(receipt => receipt.text);
  }

  /**
   * Hands the pending receipts to the prompt that carries them, so a steering that runs during that prompt does not
   * send them again; a prompt that does not deliver them gives them back with `restoreAgentReceipts`.
   */
  takeAgentReceipts(conversationKey: string): readonly AgentReceipt[] {
    const receipts = this.agentReceipts.get(conversationKey) ?? [];
    this.agentReceipts.delete(conversationKey);
    return receipts;
  }

  /** Puts receipts back among the pending ones in the order they arrived. */
  restoreAgentReceipts(conversationKey: string, receipts: readonly AgentReceipt[]): void {
    if (receipts.length > 0) {
      const pending = [...receipts, ...this.agentReceipts.get(conversationKey) ?? []];
      this.agentReceipts.set(conversationKey, pending.sort((first, second) => first.order - second.order));
    }
  }

  registerDelegation(conversationKey: string, delegation: ActiveDelegation): void {
    const runtime = this.getOrCreate(conversationKey);
    this.clearIdleTimer(runtime);
    runtime.activeDelegations.set(this.delegationKey(delegation.role), delegation);
  }

  /** Ignores a delegation that was already replaced by a newer one for the same role. */
  unregisterDelegation(conversationKey: string, delegation: ActiveDelegation): void {
    const runtime = this.runtimes.get(conversationKey);
    if (!runtime) return;
    const key = this.delegationKey(delegation.role);
    if (runtime.activeDelegations.get(key) !== delegation) {
      return;
    }
    runtime.activeDelegations.delete(key);
    this.expireWhenIdle(conversationKey, runtime);
  }

  getActiveDelegations(conversationKey: string): readonly ActiveDelegation[] {
    const runtime = this.runtimes.get(conversationKey);
    return runtime ? Array.from(runtime.activeDelegations.values()) : [];
  }

  findActiveDelegation(conversationKey: string, role: string): ActiveDelegation | undefined {
    return this.runtimes.get(conversationKey)?.activeDelegations.get(this.delegationKey(role));
  }

  /**
   * Cancels the running turn, the messages waiting in its inbox, the turns waiting to resume work and every delegation.
   * A message that arrives afterwards starts the next turn once the cancelled one has ended.
   */
  async cancel(conversationKey: string): Promise<boolean> {
    const runtime = this.runtimes.get(conversationKey);
    if (!runtime) {
      return false;
    }
    const { turn } = runtime;
    const stopped = turn?.isCancelled === false || runtime.waiters.length > 0;
    turn?.cancel().forEach(message => message.cancel());
    runtime.waiters.splice(0).forEach(waiter => waiter(undefined));
    const cancelPromises: Promise<void>[] = [];
    if (turn?.ceo) {
      cancelPromises.push(turn.ceo.cancel());
    }
    for (const delegation of runtime.activeDelegations.values()) {
      cancelPromises.push(delegation.turn.cancel());
    }
    if (cancelPromises.length === 0) {
      return stopped;
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
        this.toolSessions.close(delegation.agentPort);
        await delegation.agentPort.disconnect().catch(() => undefined);
      }
      runtime.activeDelegations.clear();
      this.closeToolSession(runtime.agentPort);
      await runtime.agentPort?.disconnect().catch(() => undefined);
    }));
  }

  private closeToolSession(agentPort: IAgentPort | null): void {
    if (agentPort) {
      this.toolSessions.close(agentPort);
    }
  }

  private delegationKey(role: string): string {
    return role.toUpperCase();
  }

  private getOrCreate(conversationKey: string): ConversationRuntime {
    let runtime = this.runtimes.get(conversationKey);
    if (!runtime) {
      runtime = {
        agentPort: null,
        turn: null,
        waiters: [],
        activeDelegations: new Map(),
        idleTimer: null,
      };
      this.runtimes.set(conversationKey, runtime);
    }
    return runtime;
  }

  /** Reads the timeout as each idle period starts, so a changed setting applies from the next one. */
  private expireWhenIdle(conversationKey: string, runtime: ConversationRuntime): void {
    if (runtime.turn || runtime.waiters.length > 0 || runtime.activeDelegations.size > 0) {
      return;
    }
    const idleTimeoutMs = this.settings.get('SESSION_IDLE_TIMEOUT_MS');
    runtime.idleTimer = setTimeout(() => {
      void this.expire(conversationKey, runtime, idleTimeoutMs);
    }, idleTimeoutMs);
    runtime.idleTimer.unref();
  }

  private clearIdleTimer(runtime: ConversationRuntime): void {
    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }
  }

  private async expire(conversationKey: string, runtime: ConversationRuntime, idleTimeoutMs: number): Promise<void> {
    runtime.idleTimer = null;
    this.runtimes.delete(conversationKey);
    this.logger.log(`[Session Expired] Conversation=${conversationKey} idle for ${idleTimeoutMs}ms`);
    for (const delegation of runtime.activeDelegations.values()) {
      this.toolSessions.close(delegation.agentPort);
      await delegation.agentPort.closeSession().catch(() => undefined);
      await delegation.agentPort.disconnect().catch(() => undefined);
    }
    runtime.activeDelegations.clear();
    this.closeToolSession(runtime.agentPort);
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
      this.toolSessions.close(current);
      await current.closeSession().catch(() => undefined);
      await current.disconnect().catch(() => undefined);
    }

    const agentPort = this.agentPortFactory.create(agentId);
    runtime.agentPort = agentPort;
    return agentPort;
  }
}
