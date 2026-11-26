import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { type AgentUsage, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { ARTIFACT_SECTION_TITLES } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { ArtifactStatus } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { statusSetByUserWhileHeld } from '../../artifacts/utils/artifact-status.util.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentRequester } from '../models/agent-request.model.js';
import type { OpenedAgentSession } from '../models/agent-session.model.js';
import { DelegationControl, type DelegationEnd, type DelegationInstruction, type FollowUp } from '../models/delegation-control.model.js';
import { PendingRequestResults } from '../models/pending-request-results.model.js';
import type { DelegationOutcome, RunningDelegations, StartedDelegation } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { AnswerDelivery, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { type AgentReceiptKind, buildAgentReceipt, buildUnrunFollowUpPrompt } from '../prompts/agent-receipt.prompt.js';
import { type AgentResultDetails, buildAgentResult } from '../prompts/agent-result.prompt.js';
import { buildFeatureScopePrompt } from '../prompts/feature-scope.prompt.js';
import { buildFollowUpPrompt, buildInstructionUpdatePrompt } from '../prompts/instruction-update.prompt.js';
import { describeDelegation } from '../prompts/previous-turn.prompt.js';
import { type AgentPrompt, type AgentPromptCost, AgentRoundService } from '../services/agent-round.service.js';
import { AgentToolSessionsService } from '../services/agent-tool-sessions.service.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationLimitsConfigService } from '../services/delegation-limits-config.service.js';
import { DelegationStatusService } from '../services/delegation-status.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { startsNewTaskSession } from '../utils/delegation-session.util.js';
import { previewForLog } from '../utils/log-preview.util.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';

import { AnswerAgentQuestionsUseCase } from './answer-agent-questions.use-case.js';
import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';


/** A delegation this use case started, with what only its own runs need. */
type LiveDelegation = ActiveDelegation & {
  readonly conversationId: string;
  readonly session: SessionContext;
  readonly sessionMode: 'resume' | 'new';
  readonly openWorkId?: string;
  stopReason?: string;
};

/** One sequence of prompts of a delegation, from an instruction to its result, for the turn that waits for it. */
type DelegationRun = {
  /** The id its delegation events carry. */
  readonly id: string;
  readonly request: TurnRequest;
  readonly round: number;
  readonly taskSpec: string;
  readonly opening: AgentPrompt;
  readonly answerDelivery?: AnswerDelivery;
  settle(outcome: DelegationOutcome): void;
};

type RunSettlement = { readonly outcome: DelegationOutcome; readonly end: DelegationEnd; readonly answered: boolean };

/** `done`: the delegation has its outcome to wait for; `wait`: it starts once that agent's work ends. */
type Arrival =
  | { readonly kind: 'done'; readonly outcome: Promise<DelegationOutcome> }
  | { readonly kind: 'wait'; readonly busy: ActiveDelegation };

type SetCancel = (cancel: () => Promise<void>) => void;

/** Whether a stop reached the delegation, which no cancel handler may be in place to receive. */
type IsCancelled = () => boolean;

const RELEASE_OUTCOMES: Readonly<Record<DelegationEnd, string>> = {
  finished: 'finished',
  failed: 'failed',
  stopped: 'stopped by the user',
  replaced: 'replaced',
  cancelled: 'cancelled',
};

function deferredOutcome(): { readonly promise: Promise<DelegationOutcome>; readonly settle: (outcome: DelegationOutcome) => void } {
  let settle!: (outcome: DelegationOutcome) => void;
  const promise = new Promise<DelegationOutcome>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * Runs the agents a CEO response delegates to: each one in its own session and folder, holding its artifact while it
 * works, and turned into an `<agent_result>` for the CEO however it ends. A delegation to a role already at work reaches
 * that agent as the CEO chose: steered into its running prompt, kept for its next prompt, run after its current work,
 * or in place of that work.
 */
@Injectable()
export class RunDelegationUseCase {
  private readonly logger = new Logger(RunDelegationUseCase.name);
  /** The CEO itself replaced these, so how they end is neither a result for it nor a reason to end the turn. */
  private readonly replacedDelegations = new WeakSet<ActiveDelegation>();
  /** Each role of a conversation decides what an arriving delegation does, and starts it, one delegation at a time. */
  private readonly roleLocks = new Map<string, Promise<void>>();

  constructor(
    @Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly questionQueue: UserQuestionQueueService,
    private readonly questionParser: QuestionParserService,
    private readonly openWork: OpenWorkService,
    private readonly artifactFormatter: ArtifactPromptFormatterService,
    private readonly agentRound: AgentRoundService,
    private readonly agentQuestions: AnswerAgentQuestionsUseCase,
    private readonly runAgentRequests: RunAgentRequestsUseCase,
    private readonly delegationStatus: DelegationStatusService,
    private readonly limits: DelegationLimitsConfigService,
    private readonly toolSessions: AgentToolSessionsService,
  ) {}

  /**
   * A failed delegation becomes a result for the CEO, so the work of the others still reaches it; a cancellation
   * ends the turn.
   */
  start(
    session: SessionContext,
    delegations: readonly ValidatedDelegation[],
    request: TurnRequest,
    round: number,
    conversationKey: string,
  ): readonly StartedDelegation[] {
    return delegations.map((delegation) => {
      let cancel: (() => Promise<void>) | undefined;
      let cancelled = false;
      const outcome = this.delegate(session, delegation, request, round, conversationKey, (next) => {
        cancel = next;
      }, () => cancelled).catch((error: unknown): DelegationOutcome => {
        if (isPromptCancellation(error)) {
          return { kind: 'cancelled', reason: error };
        }
        const { delegateToRole, projectName, artifactId } = delegation;
        return { kind: 'result', block: this.formatFailedResult(session, round, delegateToRole, projectName, error, { artifactId }) };
      });
      return {
        outcome,
        cancel: async () => {
          cancelled = true;
          await cancel?.();
        },
      };
    });
  }

  /**
   * A turn that ends with delegations still running (CEO failure, invalid response, cancellation) stops them, so no
   * agent runs unobserved: each one it is waiting for is cancelled, and so is any instruction it queued.
   */
  async stopRunning(running: RunningDelegations): Promise<void> {
    await running.cancelPending();
  }

  private async delegate(
    session: SessionContext,
    delegation: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    setCancel: SetCancel,
    isCancelled: IsCancelled,
  ): Promise<DelegationOutcome> {
    let waited = false;
    for (;;) {
      const arrival = await this.exclusive(`${conversationKey}\u0000${delegation.delegateToRole}`, async (): Promise<Arrival> => {
        const busy = this.conversationRuntime.findActiveDelegation(conversationKey, delegation.delegateToRole);
        if (!busy) {
          return { kind: 'done', ...await this.open(session, delegation, request, round, conversationKey, setCancel, isCancelled) };
        }
        return this.reachBusy(busy, session, delegation, request, round, conversationKey, setCancel, isCancelled, waited);
      });
      if (arrival.kind === 'done') {
        return arrival.outcome;
      }
      waited = true;
      await this.waitForEnd(arrival.busy, setCancel);
    }
  }

  /**
   * On the same work, the instruction is steered into the running prompt or kept for the next one, cancels the running
   * prompt to be the next at once (`interrupt`), or runs after the current run (`wait`); a run that is finishing takes it
   * as a follow-up. Other work, and a new session for the same task, waits for that agent to end or ends its work first
   * (`interrupt`), since the running prompt belongs to the session being left. Work restored after a restart has a record
   * and a first prompt of its own, so it never joins another run.
   */
  private async reachBusy(
    busy: ActiveDelegation,
    session: SessionContext,
    delegation: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    setCancel: SetCancel,
    isCancelled: IsCancelled,
    waited: boolean,
  ): Promise<Arrival> {
    const sameWork = busy.projectName === (delegation.projectName ?? null)
      && busy.artifactId === (delegation.artifactId ?? null)
      && delegation.workId === undefined
      && !startsNewTaskSession(delegation);
    const instruction: DelegationInstruction = { text: delegation.taskSpec, summary: delegation.summary };
    if (sameWork) {
      if (!delegation.onBusy && await this.steer(busy, instruction, request, round, conversationKey)) {
        return { kind: 'done', outcome: Promise.resolve({ kind: 'merged' }) };
      }
      if (delegation.onBusy === 'interrupt' && this.interrupt(busy, instruction, conversationKey)) {
        await this.instructed(busy, instruction, request, round, conversationKey, 'interrupted');
        return { kind: 'done', outcome: Promise.resolve({ kind: 'merged' }) };
      }
      const followUp = this.follow(busy, instruction, request, round, conversationKey, setCancel);
      if (followUp) {
        return { kind: 'done', outcome: followUp };
      }
    } else if (delegation.onBusy === 'interrupt') {
      await this.replace(busy, conversationKey);
      return { kind: 'done', ...await this.open(session, delegation, request, round, conversationKey, setCancel, isCancelled) };
    }
    if (!waited) {
      this.receipt(busy, conversationKey, 'waiting');
      this.logger.log(`[Delegation Waiting] Role=${busy.role}, Task="${previewForLog(delegation.taskSpec)}"`);
    }
    return { kind: 'wait', busy };
  }

  /** `false` when the run is finishing, so that nothing delivers the instruction to it any more. */
  private async steer(
    busy: ActiveDelegation,
    instruction: DelegationInstruction,
    request: TurnRequest,
    round: number,
    conversationKey: string,
  ): Promise<boolean> {
    if (!busy.control.acceptsInstructions) {
      return false;
    }
    const sentAt = new Date().toISOString();
    const update = buildInstructionUpdatePrompt([instruction.text], await this.artifactContext(busy, conversationKey, busy.control.contextSince));
    const language = await this.agentRound.buildLanguagePrompt(busy.role, request.agentRole);
    if (await busy.agentPort.sendSteeringPrompt(`${update}\n\n${language}`) === 'injected') {
      busy.control.contextSince = sentAt;
      await this.instructed(busy, instruction, request, round, conversationKey, 'steered');
      return true;
    }
    if (!busy.control.keep(instruction)) {
      return false;
    }
    await this.instructed(busy, instruction, request, round, conversationKey, 'kept');
    return true;
  }

  /**
   * Keeps the instruction and cancels the running prompt in the same tick, so the prompt cancelled is the one that
   * would not deliver it; an agent waiting for the user's answers has no prompt running, and dropping its questions
   * frees it the same way.
   */
  private interrupt(busy: ActiveDelegation, instruction: DelegationInstruction, conversationKey: string): boolean {
    if (!busy.control.keep(instruction, true)) {
      return false;
    }
    if (this.questionQueue.isWaiting(conversationKey, busy.role, busy.projectName)) {
      this.questionQueue.discard(conversationKey, busy.role, busy.projectName);
    } else {
      void busy.agentPort.cancel().catch(() => undefined);
    }
    return true;
  }

  /** `undefined` when the delegation is closing, which leaves the instruction to start on its own once it ended. */
  private follow(
    busy: ActiveDelegation,
    instruction: DelegationInstruction,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    setCancel: SetCancel,
  ): Promise<DelegationOutcome> | undefined {
    const { promise, settle } = deferredOutcome();
    const followUp: FollowUp = { instruction, request, round, settle };
    if (!busy.control.follow(followUp)) {
      return undefined;
    }
    setCancel(async () => {
      if (busy.control.withdraw(followUp)) {
        settle({ kind: 'cancelled', reason: new PromptCancelledError() });
        return;
      }
      await this.cancelLive(busy, conversationKey);
    });
    this.receipt(busy, conversationKey, 'follow_up');
    this.logger.log(`[Delegation Queued] Role=${busy.role}, Task="${previewForLog(instruction.text)}"`);
    return promise;
  }

  /** Ends the agent's work and waits until it has released its artifact, which the new delegation may need. */
  private async replace(busy: ActiveDelegation, conversationKey: string): Promise<void> {
    this.logger.log(`[Delegation Interrupted] Role=${busy.role}, ending its current work for other work`);
    this.replacedDelegations.add(busy);
    this.questionQueue.discard(conversationKey, busy.role, busy.projectName);
    await busy.turn.cancel();
    await busy.control.ended;
    this.conversationRuntime.addAgentReceipt(conversationKey, buildAgentResult(busy.role, busy.projectName ?? undefined, buildAgentReceipt('replaced'), {
      agentInfo: busy.agentInfo,
      artifactId: busy.artifactId ?? undefined,
      artifactStatus: await this.artifactStatusOf(conversationKey, busy.artifactId ?? undefined),
      status: 'interrupted',
    }));
  }

  /** A cancelled agent takes the delegations waiting for it along, as a cancellation of the conversation would. */
  private async waitForEnd(busy: ActiveDelegation, setCancel: SetCancel): Promise<void> {
    const release = busy.control.addWaiter();
    const cancelled = new Promise<never>((_resolve, reject) => {
      setCancel(async () => reject(new PromptCancelledError()));
    });
    cancelled.catch(() => undefined);
    try {
      if (await Promise.race([busy.control.ended, cancelled]) === 'cancelled') {
        throw new PromptCancelledError();
      }
    } finally {
      release();
    }
  }

  private async instructed(
    busy: ActiveDelegation,
    instruction: DelegationInstruction,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    kind: 'steered' | 'kept' | 'interrupted',
  ): Promise<void> {
    await this.recordInstruction(busy, instruction, conversationKey);
    request.onDelegation?.({
      delegationId: busy.control.runId,
      round,
      role: busy.role,
      roleName: busy.roleName,
      ...(busy.projectName ? { projectName: busy.projectName } : {}),
      ...(busy.artifactId ? { artifactId: busy.artifactId } : {}),
      summary: instruction.summary,
      taskSpec: instruction.text,
      phase: 'steered',
    });
    this.receipt(busy, conversationKey, kind);
    this.logger.log(`[Delegation Steered] Role=${busy.role}, Delivery=${kind}, NewTask="${previewForLog(instruction.text)}"`);
  }

  /** The open work keeps the task as first delegated and every instruction since, so a restart resumes with all of them. */
  private async recordInstruction(busy: ActiveDelegation, instruction: DelegationInstruction, conversationKey: string): Promise<void> {
    busy.control.record(instruction);
    await this.openWork.update(conversationKey, busy.delegationId, { summary: instruction.summary, updates: [...busy.control.updates] });
  }

  private receipt(busy: ActiveDelegation, conversationKey: string, kind: AgentReceiptKind): void {
    const status = { steered: 'steered', kept: 'queued', interrupted: 'interrupted', follow_up: 'queued', waiting: 'queued', replaced: 'interrupted' } as const;
    this.conversationRuntime.addAgentReceipt(conversationKey, buildAgentResult(busy.role, busy.projectName ?? undefined, buildAgentReceipt(kind), {
      agentInfo: busy.agentInfo,
      artifactId: busy.artifactId ?? undefined,
      status: status[kind],
    }));
  }

  /** Registers the agent before releasing the role, so the next delegation to arrive finds it at work. */
  private async open(
    session: SessionContext,
    { delegateToRole: role, projectName, taskSpec, summary, sessionMode, cwd, workId, firstPrompt, answerDelivery, artifactId, updates }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    setCancel: SetCancel,
    isCancelled: IsCancelled,
  ): Promise<{ readonly outcome: Promise<DelegationOutcome> }> {
    await this.replaceInterruptedWork(conversationKey, role, workId);

    const delegationId = workId ?? randomUUID();
    const roleName = this.agentRegistry.getDisplayName(role);
    const agentPort = this.agentPortFactory.create(await this.agentRound.resolveAgentId(request.conversationId, role));
    const agentInfo = await this.agentRound.buildAgentInfo(agentPort, role, request.conversationId);
    if (isCancelled()) {
      throw new PromptCancelledError();
    }
    if (artifactId) {
      const assigned = await this.artifacts.assign(request.conversationId, artifactId, { role, roleName, delegationId });
      if (!assigned.ok) {
        const block = this.formatFailedResult(session, round, role, projectName, new Error(assigned.error), {
          artifactId,
          artifactStatus: await this.artifactStatusOf(request.conversationId, artifactId),
        });
        return { outcome: Promise.resolve({ kind: 'result', block }) };
      }
      if (isCancelled()) {
        await this.artifacts.release(request.conversationId, artifactId, delegationId, RELEASE_OUTCOMES.cancelled).catch((error: unknown) => {
          this.logger.error(`[Artifact Release Failed] ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        });
        throw new PromptCancelledError();
      }
    }

    const startedAt = Date.now();
    const turn = new ActiveTurn(agentPort);
    const control = new DelegationControl({ runId: delegationId, summary, updates, contextSince: new Date(startedAt).toISOString() });
    const live: LiveDelegation = {
      delegationId,
      role,
      roleName,
      agentInfo,
      projectName: projectName ?? null,
      artifactId: artifactId ?? null,
      get summary() {
        return control.summary;
      },
      taskSpec,
      cwd,
      startedAt,
      agentPort,
      turn,
      control,
      conversationId: request.conversationId,
      session,
      // A task has a session of its own that a delegation resumes unless it asks for a new one, so the role's default mode chooses only among the sessions of work without a task.
      sessionMode: artifactId ? sessionMode ?? 'resume' : sessionMode ?? this.agentRegistry.getDefaultSessionMode(role),
      ...(request.resumable ? { openWorkId: delegationId } : {}),
      stop: async (reason: string) => {
        live.stopReason = reason;
        this.questionQueue.discard(conversationKey, role, projectName ?? null);
        await turn.cancel();
      },
    };

    this.conversationRuntime.registerDelegation(conversationKey, live);
    setCancel(() => this.cancelLive(live, conversationKey));
    if (live.openWorkId) {
      await this.openWork.open(conversationKey, {
        id: live.openWorkId,
        role,
        roleName,
        projectName: projectName ?? null,
        ...(artifactId ? { artifactId } : {}),
        summary,
        taskSpec,
        ...(updates?.length ? { updates } : {}),
        cwd,
        round,
        root: false,
        ...(answerDelivery ? { questions: answerDelivery.questions } : {}),
      });
    }

    const { promise, settle } = deferredOutcome();
    const first: DelegationRun = {
      id: delegationId,
      request,
      round,
      taskSpec,
      opening: opened => this.openingPrompt(opened, request.conversationId, { artifactId, taskSpec, firstPrompt }),
      ...(answerDelivery ? { answerDelivery } : {}),
      settle,
    };
    void this.drive(live, first, conversationKey);
    return { outcome: promise };
  }

  /**
   * Runs the first run and then each follow-up in the same session. A run followed by another gets its result at once;
   * the last one only after the delegation released its artifact, which the CEO may delegate next. Follow-ups a failed,
   * stopped or replaced delegation never ran become failed results, and a cancelled one takes them along.
   */
  private async drive(live: LiveDelegation, first: DelegationRun, conversationKey: string): Promise<void> {
    let run = first;
    let settled = await this.settleRun(live, run, conversationKey);
    let answered = settled.answered;
    let next = settled.end === 'finished' ? live.control.next() : undefined;
    while (next) {
      run.settle(settled.outcome);
      await this.recordInstruction(live, next.instruction, conversationKey);
      run = this.followUpRun(live, next, conversationKey);
      settled = await this.settleRun(live, run, conversationKey);
      answered ||= settled.answered;
      next = settled.end === 'finished' ? live.control.next() : undefined;
    }
    const { end } = settled;
    const unrun = live.control.close();
    await this.close(live, end, answered, conversationKey);
    run.settle(settled.outcome);
    for (const followUp of unrun) {
      followUp.settle(end === 'cancelled'
        ? { kind: 'cancelled', reason: new PromptCancelledError() }
        : {
          kind: 'result', block: buildAgentResult(live.role, live.projectName ?? undefined, buildUnrunFollowUpPrompt(RELEASE_OUTCOMES[end]), {
            agentInfo: live.agentInfo,
            artifactId: live.artifactId ?? undefined,
            status: 'failed',
          }),
        });
    }
    live.control.finish(end);
  }

  /** A run that could not even report how it ended (the board failing while it read its artifact) failed. */
  private settleRun(live: LiveDelegation, run: DelegationRun, conversationKey: string): Promise<RunSettlement> {
    return this.executeRun(live, run, conversationKey).catch((error: unknown): RunSettlement => ({
      outcome: { kind: 'result', block: this.formatFailedResult(live.session, run.round, live.role, live.projectName ?? undefined, error, { agentInfo: live.agentInfo }) },
      end: 'failed',
      answered: false,
    }));
  }

  private followUpRun(live: LiveDelegation, followUp: FollowUp, conversationKey: string): DelegationRun {
    return {
      id: randomUUID(),
      request: followUp.request,
      round: followUp.round,
      taskSpec: followUp.instruction.text,
      opening: async () => buildFollowUpPrompt(followUp.instruction.text, await this.takeArtifactContext(live, conversationKey)),
      settle: followUp.settle,
    };
  }

  /** However the agent's work ends becomes the run's outcome, with how that ends the delegation. */
  private async executeRun(live: LiveDelegation, run: DelegationRun, conversationKey: string): Promise<RunSettlement> {
    const { role, roleName, conversationId, artifactId } = live;
    const projectName = live.projectName ?? undefined;
    const { request, round } = run;
    live.control.runId = run.id;
    // The summary as it stands when each event goes out, which a steering may have changed since the run started.
    const base = {
      delegationId: run.id,
      round,
      role,
      roleName,
      projectName,
      ...(artifactId ? { artifactId } : {}),
      taskSpec: run.taskSpec,
    };
    const event = () => ({ ...base, summary: live.summary });
    const startedAt = Date.now();
    this.logger.log(
      `[Delegation Started] Conversation=${conversationId}, Round=${round}, Role=${role} (${roleName}), Project=${projectName ?? 'none'}, Cwd=${live.cwd}, Task="${previewForLog(run.taskSpec)}"`,
    );
    request.onDelegation?.({ ...event(), phase: 'started' });

    const costs: AgentPromptCost[] = [];
    const answered = () => costs.length > 0;
    let workingStatus: ArtifactStatus | undefined;
    try {
      if (artifactId) {
        workingStatus = await this.delegationStatus.start(conversationId, artifactId, role);
      }
      const response = await this.runPrompts(live, run, costs, conversationKey);
      const durationMs = Date.now() - startedAt;
      const usage = this.totalUsage(costs);
      const promptChars = costs.reduce((total, cost) => total + cost.promptChars, 0);
      const tokens = usage ? `, InputTokens=${usage.inputTokens}, OutputTokens=${usage.outputTokens}, TotalTokens=${usage.totalTokens}` : '';
      this.logger.log(
        `[Delegation Finished] Conversation=${conversationId}, Round=${round}, Role=${role}, Duration=${(durationMs / 1000).toFixed(1)}s, ResponseLength=${response.length}, Prompts=${costs.length}, PromptChars=${promptChars}${tokens}`,
      );
      request.onDelegation?.({
        ...event(),
        phase: 'finished',
        response,
        agentInfo: await this.agentRound.buildAgentInfo(live.agentPort, role, conversationId),
        usage,
        durationMs,
      });
      const verdict = artifactId ? await this.delegationStatus.finish(conversationId, artifactId, role, response, workingStatus) : undefined;
      const block = buildAgentResult(role, projectName, verdict?.closesStep ? this.receiptOf(response, role, artifactId!) : response, {
        agentInfo: live.agentInfo,
        ...await this.heldArtifactDetails(conversationId, artifactId ?? undefined),
        ...(verdict ? { verdict: verdict.verdict } : {}),
      });
      return { outcome: { kind: 'result', block }, end: 'finished', answered: answered() };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      // Closing a replaced agent's session can surface as any error, none of which is a failure of its task.
      if (this.replacedDelegations.has(live)) {
        request.onDelegation?.({ ...event(), phase: 'cancelled', durationMs });
        return { outcome: { kind: 'replaced' }, end: 'replaced', answered: answered() };
      }
      if (live.stopReason !== undefined) {
        request.onDelegation?.({ ...event(), phase: 'cancelled', durationMs });
        this.logger.log(`[Delegation Stopped] Conversation=${conversationId}, Round=${round}, Role=${role}: ${live.stopReason}`);
        const block = buildAgentResult(role, projectName, live.stopReason, {
          agentInfo: live.agentInfo,
          status: 'stopped',
          ...await this.heldArtifactDetails(conversationId, artifactId ?? undefined),
        });
        return { outcome: { kind: 'result', block }, end: 'stopped', answered: answered() };
      }
      if (isPromptCancellation(error)) {
        request.onDelegation?.({ ...event(), phase: 'cancelled', durationMs });
        this.conversationRuntime.addCeoNotice(conversationKey, `${describeDelegation(role, live.projectName, run.taskSpec)} was stopped before finishing.`);
        return { outcome: { kind: 'cancelled', reason: error }, end: 'cancelled', answered: answered() };
      }
      request.onDelegation?.({ ...event(), phase: 'failed', errorMessage: error instanceof Error ? error.message : String(error), durationMs });
      const block = this.formatFailedResult(live.session, round, role, projectName, error, {
        agentInfo: live.agentInfo,
        ...await this.heldArtifactDetails(conversationId, artifactId ?? undefined),
      });
      return { outcome: { kind: 'result', block }, end: 'failed', answered: answered() };
    }
  }

  /**
   * The prompts of one run until its final response, its questions answered on the way. Every prompt carries the
   * instructions kept for it; a prompt cancelled to deliver them is followed by one that does, and a run whose last
   * prompt left some kept sends one more before it ends.
   */
  private async runPrompts(live: LiveDelegation, run: DelegationRun, costs: AgentPromptCost[], conversationKey: string): Promise<string> {
    const { role, roleName, conversationId, delegationId, agentPort, turn } = live;
    const artifactId = live.artifactId ?? undefined;
    const projectName = live.projectName ?? undefined;
    const requester: AgentRequester = {
      role,
      roleName,
      conversationId,
      delegationId,
      ...(artifactId ? { artifactId } : {}),
    };
    const runRound = (prompt: AgentPrompt, delivery?: AnswerDelivery) => this.agentRound.run({
      agentPort,
      cwd: live.cwd,
      role,
      requester,
      prompt: this.withInstructions(live, prompt, conversationKey),
      request: run.request,
      turn,
      session: live.session,
      sessionMode: live.sessionMode,
      projectName,
      artifactId,
      answerDelivery: delivery,
      onPrompt: cost => costs.push(cost),
    });
    const pending = new PendingRequestResults();
    const resolveRequests = async (response: string) => pending.keep(await this.runAgentRequests.resolve(
      response,
      results => runRound(results),
      { ...requester, agentInterface: this.agentRound.interfaceOf(agentPort) },
      rest => this.questionParser.parse(rest).kind !== 'none',
      activity => run.request.onActivity?.(activity, role),
    ));
    const answer = async (prompt: AgentPrompt, delivery?: AnswerDelivery) => this.agentQuestions.execute(
      await resolveRequests(await runRound(prompt, delivery)),
      async text => resolveRequests(await runRound(pending.before(text))),
      this.agentQuestions.askerFor(role, projectName, artifactId),
      run.request,
      live.openWorkId,
    );

    let prompt: AgentPrompt = run.opening;
    let delivery = run.answerDelivery;
    for (;;) {
      try {
        const response = await answer(prompt, delivery);
        if (live.control.seal()) {
          return response;
        }
      } catch (error) {
        if (!isPromptCancellation(error) || turn.isCancelled || !live.control.takeInterruption()) {
          throw error;
        }
        this.logger.log(`[Delegation Interrupted] Role=${role}, sending the instructions that interrupted it`);
      }
      prompt = '';
      delivery = undefined;
    }
  }

  /** The prompt with the instructions kept until it is written, which it delivers. */
  private withInstructions(live: LiveDelegation, prompt: AgentPrompt, conversationKey: string): AgentPrompt {
    return async (opened) => {
      const base = typeof prompt === 'string' ? prompt : await prompt(opened);
      const kept = live.control.take();
      if (kept.length === 0) {
        return base;
      }
      const update = buildInstructionUpdatePrompt(kept.map(instruction => instruction.text), await this.takeArtifactContext(live, conversationKey));
      return base ? `${base}\n\n${update}` : update;
    };
  }

  /** What changed on the agent's artifact since it was last sent, which it is told now. */
  private async takeArtifactContext(live: ActiveDelegation, conversationKey: string): Promise<string | undefined> {
    const sentAt = new Date().toISOString();
    const context = await this.artifactContext(live, conversationKey, live.control.contextSince);
    live.control.contextSince = sentAt;
    return context;
  }

  /** A feature comes whole, with the projects it limits its agent to as they stand now, since what changed in its tasks is not in its own history. */
  private async artifactContext(busy: ActiveDelegation, conversationId: string, since: string): Promise<string | undefined> {
    if (!busy.artifactId) {
      return undefined;
    }
    const all = await this.artifacts.list(conversationId, { statuses: 'all' });
    const artifact = all.find(candidate => candidate.id === busy.artifactId);
    if (!artifact) {
      return undefined;
    }
    return artifact.type === 'task'
      ? this.artifactFormatter.changesSince(artifact, all, since, 'received')
      : `${buildFeatureScopePrompt(artifact.projectNames)}\n\n${this.artifactFormatter.detail(artifact, all)}`;
  }

  private async cancelLive(busy: ActiveDelegation, conversationKey: string): Promise<void> {
    this.questionQueue.discard(conversationKey, busy.role, busy.projectName);
    await busy.turn.cancel();
  }

  /** Releases the artifact, records the end of work on the session when the agent answered a prompt, and closes the agent. */
  private async close(live: LiveDelegation, end: DelegationEnd, answered: boolean, conversationKey: string): Promise<void> {
    const { artifactId, agentPort } = live;
    if (live.openWorkId) {
      await this.openWork.close(conversationKey, live.openWorkId);
    }
    if (artifactId) {
      await this.artifacts.release(live.conversationId, artifactId, live.delegationId, RELEASE_OUTCOMES[end]).catch((error: unknown) => {
        this.logger.error(`[Artifact Release Failed] ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      // A delegation the agent answered no prompt of may have shown its session nothing, so the earlier end of work stands.
      if (answered) {
        await this.agentRound.recordWorkEnded(live.session, agentPort, {
          role: live.role,
          agentId: agentPort.agentName,
          projectName: live.projectName,
          artifactId,
        }).catch((error: unknown) => {
          this.logger.error(`[Session Record Failed] ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
    this.conversationRuntime.unregisterDelegation(conversationKey, live);
    this.toolSessions.close(agentPort);
    await agentPort.closeSession().catch(() => undefined);
    await agentPort.disconnect().catch(() => undefined);
  }

  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.roleLocks.get(key) ?? Promise.resolve();
    const result = previous.then(work);
    const tail = result.then(() => undefined, () => undefined);
    this.roleLocks.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.roleLocks.get(key) === tail) {
        this.roleLocks.delete(key);
      }
    }
  }

  /** The usage of every prompt of a run added up, field by field; a field no prompt reported stays out. */
  private totalUsage(costs: readonly AgentPromptCost[]): AgentUsage | undefined {
    const usages = costs.flatMap(cost => (cost.usage ? [cost.usage] : []));
    if (usages.length === 0) {
      return undefined;
    }
    const sum = (field: keyof AgentUsage): number => usages.reduce((total, usage) => total + (usage[field] ?? 0), 0);
    const optional = (field: 'thoughtTokens' | 'cachedReadTokens' | 'cachedWriteTokens') =>
      (usages.some(usage => usage[field] !== undefined) ? { [field]: sum(field) } : {});
    return {
      totalTokens: sum('totalTokens'),
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      ...optional('thoughtTokens'),
      ...optional('cachedReadTokens'),
      ...optional('cachedWriteTokens'),
    };
  }

  /**
   * The agent starts from the artifact it holds, so the specification only says what to do with it. A session new to
   * the task gets its whole content; one whose work on the task ended before gets what changed since. A session that
   * carries on from where it stopped (a `firstPrompt`) was holding the task until then, so it gets the prompt alone. A
   * feature always comes whole, since what changed in its tasks is not in its own history, and says which of its
   * projects the agent may change from the workspaces root.
   */
  private async openingPrompt(
    opened: OpenedAgentSession,
    conversationId: string,
    { artifactId, taskSpec, firstPrompt }: Pick<ValidatedDelegation, 'artifactId' | 'taskSpec' | 'firstPrompt'>,
  ): Promise<string> {
    const text = firstPrompt ?? taskSpec;
    const newSession = opened.state === 'new';
    if (!artifactId || (firstPrompt !== undefined && !newSession)) {
      return text;
    }
    const all = await this.artifacts.list(conversationId, { statuses: 'all' });
    const artifact = all.find(candidate => candidate.id === artifactId)!;
    const content = !newSession && opened.workEndedAt && artifact.type === 'task'
      ? this.artifactFormatter.changesSince(artifact, all, opened.workEndedAt)
      : this.artifactFormatter.detail(artifact, all);
    const scope = artifact.type === 'feature' ? `\n${buildFeatureScopePrompt(artifact.projectNames)}` : '';
    return `[DELEGATED_ARTIFACT]\nYou hold ${artifactId} while you work on it.${scope}\n\n${content}\n[/DELEGATED_ARTIFACT]\n\n${text}`;
  }

  /**
   * A verdict that closed a step comes with a report the agent wrote on its task, so past the limit the CEO gets its
   * start and where the rest is. A verdict that keeps the task where it was carries what the CEO must act on, whole.
   */
  private receiptOf(response: string, role: string, artifactId: string): string {
    const maxChars = this.limits.getMaxResultChars();
    if (maxChars === 0 || response.length <= maxChars) {
      return response;
    }
    const sections = this.agentRegistry.getArtifactAccess(role).sections.map(section => ARTIFACT_SECTION_TITLES[section]);
    const where = sections.length > 0 ? `${artifactId}, in its ${sections.join(' or ')} section` : artifactId;
    return `${response.slice(0, maxChars).trimEnd()}\n\n[The rest of this result, ${response.length - maxChars} characters, was left out. The full report is on ${where}.]`;
  }

  /** A new delegation of a role takes the place of whatever a restart left stopped for it. */
  private async replaceInterruptedWork(conversationKey: string, role: string, keptWorkId: string | undefined): Promise<void> {
    for (const work of this.openWork.interrupted(conversationKey)) {
      if (work.role === role && work.id !== keptWorkId) {
        this.questionQueue.discard(conversationKey, role, work.projectName);
        await this.openWork.close(conversationKey, work.id);
      }
    }
  }

  /** Read before the delegation releases its artifact, so a status the user set during the work is still told apart. */
  private async heldArtifactDetails(conversationId: string, artifactId: string | undefined): Promise<Pick<AgentResultDetails, 'artifactId' | 'artifactStatus' | 'artifactStatusByUser'>> {
    const artifact = artifactId ? await this.artifacts.get(conversationId, artifactId) : undefined;
    if (!artifact) {
      return { artifactId };
    }
    return { artifactId, artifactStatus: artifact.status, ...(statusSetByUserWhileHeld(artifact) && { artifactStatusByUser: true }) };
  }

  private async artifactStatusOf(conversationId: string, artifactId: string | undefined): Promise<string | undefined> {
    return artifactId ? (await this.artifacts.get(conversationId, artifactId))?.status : undefined;
  }

  private formatFailedResult(
    session: SessionContext,
    round: number,
    delegateToRole: string,
    projectName: string | undefined,
    error: unknown,
    details: Omit<AgentResultDetails, 'status'> = {},
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`[Delegation Failed] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}: ${message}`);
    return buildAgentResult(delegateToRole, projectName, message, { ...details, status: 'failed' });
  }
}
