import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { AgentUsage } from '../../agent/ports/agent.port.js';
import { ARTIFACT_SECTION_TITLES } from '../../artifacts/constants/artifact-catalog.constant.js';
import type { ArtifactStatus } from '../../artifacts/models/artifact.model.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { statusSetByUserWhileHeld } from '../../artifacts/utils/artifact-status.util.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentRequester } from '../models/agent-request.model.js';
import type { OpenedAgentSession } from '../models/agent-session.model.js';
import { PendingRequestResults } from '../models/pending-request-results.model.js';
import { type DelegationOutcome, RunningDelegations, type StartedDelegation } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { AnswerDelivery, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { type AgentResultDetails, buildAgentResult } from '../prompts/agent-result.prompt.js';
import { describeDelegation } from '../prompts/previous-turn.prompt.js';
import { type AgentPrompt, type AgentPromptCost, AgentRoundService } from '../services/agent-round.service.js';
import { ArtifactPromptFormatterService } from '../services/artifact-prompt-formatter.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationLimitsConfigService } from '../services/delegation-limits-config.service.js';
import { DelegationStatusService } from '../services/delegation-status.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { previewForLog } from '../utils/log-preview.util.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';

import { AnswerAgentQuestionsUseCase } from './answer-agent-questions.use-case.js';
import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';


/**
 * Runs the agents a CEO response delegates to: each one in its own session and folder, holding its artifact while it
 * works, steered when it is already running on the same work, and turned into an `<agent_result>` for the CEO however
 * it ends.
 */
@Injectable()
export class RunDelegationUseCase {
  private readonly logger = new Logger(RunDelegationUseCase.name);
  /** The CEO itself replaced these, so how they end is neither a result for it nor a reason to end the turn. */
  private readonly replacedDelegations = new WeakSet<ActiveDelegation>();
  /** A role can pass to another turn's agent while the replaced one closes, so the role alone does not say whose agent it is. */
  private readonly delegationOwners = new WeakMap<ActiveDelegation, RunningDelegations>();

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
    running: RunningDelegations,
  ): readonly StartedDelegation[] {
    return delegations.map(delegation => ({
      role: delegation.delegateToRole,
      outcome: this.delegate(session, delegation, request, round, conversationKey, running).then(
        (block): DelegationOutcome => (block === undefined ? { kind: 'replaced' } : { kind: 'result', block }),
        (error): DelegationOutcome => {
          if (isPromptCancellation(error)) {
            return { kind: 'cancelled', reason: error };
          }
          const { delegateToRole, projectName, artifactId } = delegation;
          return { kind: 'result', block: this.formatFailedResult(session, round, delegateToRole, projectName, error, { artifactId }) };
        },
      ),
    }));
  }

  /**
   * A turn that ends with delegations still running (CEO failure, invalid response, cancellation) stops them, so no
   * agent runs unobserved. Discarding the questions of an agent waiting for the user is what releases it: its wait
   * would otherwise hold the turn open until the user answered a question nobody would receive.
   */
  async stopRunning(running: RunningDelegations, conversationKey: string): Promise<void> {
    const stopping = running.pendingRoles
      .map(role => this.conversationRuntime.findActiveDelegation(conversationKey, role))
      .filter(delegation => delegation !== undefined)
      .filter(delegation => this.delegationOwners.get(delegation) === running);
    await Promise.allSettled(
      stopping.map((delegation) => {
        this.questionQueue.discard(conversationKey, delegation.role, delegation.projectName);
        return delegation.turn.cancel();
      }),
    );
    await running.settled();
  }

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec, summary, sessionMode, cwd, workId, firstPrompt, answerDelivery, artifactId }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    running: RunningDelegations,
  ): Promise<string | undefined> {
    const existing = this.conversationRuntime.findActiveDelegation(conversationKey, delegateToRole);
    if (existing) {
      const sameProject = existing.projectName === (projectName ?? null);
      const awaitingAnswers = this.questionQueue.isWaiting(conversationKey, delegateToRole, existing.projectName);
      const sameArtifact = existing.artifactId === (artifactId ?? null);
      if (sameProject && sameArtifact && !awaitingAnswers && existing.agentPort.supportsSteering && await existing.steer(taskSpec)) {
        this.logger.log(
          `[Delegation Steered] Role=${delegateToRole}, NewTask="${previewForLog(taskSpec)}"`,
        );
        return buildAgentResult(delegateToRole, projectName, 'Steering message sent to active agent.', { agentInfo: existing.agentInfo });
      }

      this.logger.log(
        `[Delegation Restarted] Role=${delegateToRole}, Cancelling and recreating agent process (steering unavailable or project changed)`,
      );
      this.replacedDelegations.add(existing);
      this.questionQueue.discard(conversationKey, delegateToRole, existing.projectName);
      await existing.turn.cancel();
      await existing.agentPort.closeSession().catch(() => undefined);
      await existing.agentPort.disconnect().catch(() => undefined);
      this.conversationRuntime.unregisterDelegation(conversationKey, existing);
    }

    await this.replaceInterruptedWork(conversationKey, delegateToRole, workId);

    const delegationId = workId ?? randomUUID();
    const roleName = this.agentRegistry.getDisplayName(delegateToRole);
    if (artifactId) {
      const assigned = await this.artifacts.assign(request.conversationId, artifactId, { role: delegateToRole, roleName, delegationId });
      if (!assigned.ok) {
        return this.formatFailedResult(session, round, delegateToRole, projectName, new Error(assigned.error), {
          artifactId,
          artifactStatus: await this.artifactStatusOf(request.conversationId, artifactId),
        });
      }
    }

    const delegatePort = this.agentPortFactory.create(
      await this.agentRound.resolveAgentId(request.conversationId, delegateToRole),
    );
    const agentInfo = await this.agentRound.buildAgentInfo(delegatePort, delegateToRole, request.conversationId);
    const event = {
      delegationId,
      round,
      role: delegateToRole,
      roleName,
      projectName,
      ...(artifactId ? { artifactId } : {}),
      summary,
      taskSpec,
    };
    const startedAt = Date.now();

    this.logger.log(
      `[Delegation Started] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole} (${event.roleName}), Project=${projectName ?? 'none'}, Cwd=${cwd}, Task="${previewForLog(taskSpec)}"`,
    );
    request.onDelegation?.({ ...event, phase: 'started' });

    // A task has a session of its own, so the session mode chooses only among the sessions of work without one.
    const effectiveSessionMode = artifactId ? 'resume' : sessionMode ?? this.agentRegistry.getDefaultSessionMode(delegateToRole);
    let currentTaskSpec = taskSpec;
    const openWorkId = request.resumable ? event.delegationId : undefined;

    const delegationTurn = new ActiveTurn(delegatePort);
    let stopReason: string | undefined;
    const activeDelegation: ActiveDelegation = {
      delegationId,
      role: delegateToRole,
      roleName: event.roleName,
      agentInfo,
      projectName: projectName ?? null,
      artifactId: artifactId ?? null,
      summary,
      get taskSpec() {
        return currentTaskSpec;
      },
      cwd,
      startedAt,
      agentPort: delegatePort,
      turn: delegationTurn,
      steer: async (newSpec: string) => {
        currentTaskSpec = newSpec;
        if (openWorkId) {
          await this.openWork.update(conversationKey, openWorkId, { taskSpec: newSpec });
        }
        const languagePrompt = await this.agentRound.buildLanguagePrompt(delegateToRole, request.agentRole);
        return delegatePort.supportsSteering && delegatePort.sendSteeringPrompt(`${newSpec}\n\n${languagePrompt}`);
      },
      stop: async (reason: string) => {
        stopReason = reason;
        this.questionQueue.discard(conversationKey, delegateToRole, projectName ?? null);
        await delegationTurn.cancel();
      },
    };

    this.delegationOwners.set(activeDelegation, running);
    this.conversationRuntime.registerDelegation(conversationKey, activeDelegation);
    if (openWorkId) {
      await this.openWork.open(conversationKey, {
        id: openWorkId,
        role: delegateToRole,
        roleName: event.roleName,
        projectName: projectName ?? null,
        ...(artifactId ? { artifactId } : {}),
        summary,
        taskSpec,
        cwd,
        round,
        root: false,
        ...(answerDelivery ? { questions: answerDelivery.questions } : {}),
      });
    }

    let outcome = 'stopped';
    const costs: AgentPromptCost[] = [];
    let workingStatus: ArtifactStatus | undefined;
    try {
      if (artifactId) {
        workingStatus = await this.delegationStatus.start(request.conversationId, artifactId, delegateToRole);
      }
      const runRound = (prompt: AgentPrompt, delivery?: AnswerDelivery) => this.agentRound.run({
        agentPort: delegatePort,
        cwd,
        role: delegateToRole,
        prompt,
        request,
        turn: delegationTurn,
        session,
        sessionMode: effectiveSessionMode,
        projectName,
        artifactId,
        answerDelivery: delivery,
        onPrompt: cost => costs.push(cost),
      });
      const requester: AgentRequester = {
        role: delegateToRole,
        roleName,
        conversationId: request.conversationId,
        delegationId,
        ...(artifactId ? { artifactId } : {}),
      };
      const pending = new PendingRequestResults();
      const resolveRequests = async (response: string) => pending.keep(await this.runAgentRequests.resolve(
        response,
        results => runRound(results),
        requester,
        rest => this.questionParser.parse(rest).kind !== 'none',
        activity => request.onActivity?.(activity, requester.role),
      ));
      const opening = (opened: OpenedAgentSession) => this.openingPrompt(opened, request.conversationId, {
        artifactId,
        taskSpec: currentTaskSpec,
        firstPrompt,
      });
      const response = await this.agentQuestions.execute(
        await resolveRequests(await runRound(opening, answerDelivery)),
        async text => resolveRequests(await runRound(pending.before(text))),
        this.agentQuestions.askerFor(delegateToRole, projectName, artifactId),
        request,
        openWorkId,
      );
      const durationMs = Date.now() - startedAt;
      const usage = this.totalUsage(costs);
      const promptChars = costs.reduce((total, cost) => total + cost.promptChars, 0);
      const tokens = usage ? `, InputTokens=${usage.inputTokens}, OutputTokens=${usage.outputTokens}, TotalTokens=${usage.totalTokens}` : '';
      this.logger.log(
        `[Delegation Finished] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}, Duration=${(durationMs / 1000).toFixed(1)}s, ResponseLength=${response.length}, Prompts=${costs.length}, PromptChars=${promptChars}${tokens}`,
      );
      request.onDelegation?.({
        ...event,
        phase: 'finished',
        response,
        agentInfo: await this.agentRound.buildAgentInfo(delegatePort, delegateToRole, request.conversationId),
        usage,
        durationMs,
      });
      outcome = 'finished';
      const verdict = artifactId ? await this.delegationStatus.finish(request.conversationId, artifactId, delegateToRole, response, workingStatus) : undefined;
      return buildAgentResult(delegateToRole, projectName, verdict?.closesStep ? this.receipt(response, delegateToRole, artifactId!) : response, {
        agentInfo,
        ...await this.heldArtifactDetails(request.conversationId, artifactId),
        ...(verdict ? { verdict: verdict.verdict } : {}),
      });
    } catch (error) {
      // Closing a replaced agent's session can surface as any error, none of which is a failure of its task.
      if (this.replacedDelegations.has(activeDelegation)) {
        outcome = 'replaced';
        request.onDelegation?.({ ...event, phase: 'cancelled', durationMs: Date.now() - startedAt });
        return undefined;
      }
      if (stopReason !== undefined) {
        outcome = 'stopped by the user';
        request.onDelegation?.({ ...event, phase: 'cancelled', durationMs: Date.now() - startedAt });
        this.logger.log(`[Delegation Stopped] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}: ${stopReason}`);
        return buildAgentResult(delegateToRole, projectName, stopReason, {
          agentInfo,
          status: 'stopped',
          ...await this.heldArtifactDetails(request.conversationId, artifactId),
        });
      }
      if (isPromptCancellation(error)) {
        outcome = 'cancelled';
        request.onDelegation?.({ ...event, phase: 'cancelled', durationMs: Date.now() - startedAt });
        this.conversationRuntime.addCeoNotice(conversationKey, `${describeDelegation(delegateToRole, activeDelegation.projectName, currentTaskSpec)} was stopped before finishing.`);
        throw error;
      }
      request.onDelegation?.({
        ...event,
        phase: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      outcome = 'failed';
      return this.formatFailedResult(session, round, delegateToRole, projectName, error, {
        agentInfo,
        ...await this.heldArtifactDetails(request.conversationId, artifactId),
      });
    } finally {
      if (openWorkId) {
        await this.openWork.close(conversationKey, openWorkId);
      }
      if (artifactId) {
        await this.artifacts.release(request.conversationId, artifactId, delegationId, outcome).catch((error: unknown) => {
          this.logger.error(`[Artifact Release Failed] ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        });
        await this.agentRound.recordWorkEnded(session, delegatePort, {
          role: delegateToRole,
          agentId: delegatePort.agentName,
          projectName: projectName ?? null,
          artifactId,
        }).catch((error: unknown) => {
          this.logger.error(`[Session Record Failed] ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      this.conversationRuntime.unregisterDelegation(conversationKey, activeDelegation);
      await delegatePort.closeSession().catch(() => undefined);
      await delegatePort.disconnect().catch(() => undefined);
    }
  }

  /** The usage of every prompt of a delegation added up, field by field; a field no prompt reported stays out. */
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
   * feature always comes whole, since what changed in its tasks is not in its own history.
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
    return `[DELEGATED_ARTIFACT]\nYou hold ${artifactId} while you work on it.\n\n${content}\n[/DELEGATED_ARTIFACT]\n\n${text}`;
  }

  /**
   * A verdict that closed a step comes with a report the agent wrote on its task, so past the limit the CEO gets its
   * start and where the rest is. A verdict that keeps the task where it was carries what the CEO must act on, whole.
   */
  private receipt(response: string, role: string, artifactId: string): string {
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
