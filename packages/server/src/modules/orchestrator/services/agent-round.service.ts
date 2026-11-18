import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { AnswerDelivery } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { IAgentSkillsPort } from '../ports/agent-skills.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildAgentRetryPrompt } from '../prompts/agent-retry.prompt.js';
import { buildProtocolRepairPrompt } from '../prompts/protocol-repair.prompt.js';
import { buildLostSessionTaskPrompt } from '../prompts/resumed-work.prompt.js';
import { buildSkillCatalogPrompt } from '../prompts/skill-catalog.prompt.js';
import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
  DEFAULT_USER_LANGUAGE,
} from '../prompts/user-language.prompt.js';
import { resolveProfile } from '../utils/agent-profile.util.js';
import { previewForLog } from '../utils/log-preview.util.js';
import { isRetryableAgentError } from '../utils/retryable-agent-error.util.js';

import { AgentProtocolService } from './agent-protocol.service.js';
import { AgentRetryConfigService } from './agent-retry-config.service.js';
import { OpenWorkService } from './open-work.service.js';


export type AgentRoundInput = {
  readonly agentPort: IAgentPort;
  /** The folder the session of the agent runs in. */
  readonly cwd: string;
  readonly role: string;
  readonly prompt: string;
  readonly request: TurnRequest;
  readonly turn: ActiveTurn;
  readonly session: SessionContext;
  readonly sessionMode?: 'resume' | 'new';
  readonly projectName?: string;
  /** A message the user wrote, which brings the CEO its system prompt again when it gets one every turn. */
  readonly isUserMessage?: boolean;
  readonly answerDelivery?: AnswerDelivery;
};

/** Runs the prompts of one agent in the session the conversation keeps for its role and project, with the role's profile. */
@Injectable()
export class AgentRoundService {
  private readonly logger = new Logger(AgentRoundService.name);
  private sessionBindings: Promise<void> = Promise.resolve();

  constructor(
    @Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory,
    @Inject(ISessionStorePort) private readonly sessionStore: ISessionStorePort,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IWorkspacePort) private readonly workspacePort: IWorkspacePort,
    @Inject(IAgentSettingsStorePort) private readonly settingsStore: IAgentSettingsStorePort,
    @Inject(IPreferencesStorePort) private readonly preferencesStore: IPreferencesStorePort,
    private readonly agentProtocol: AgentProtocolService,
    private readonly openWork: OpenWorkService,
    @Inject(IAgentSkillsPort) private readonly agentSkills: IAgentSkillsPort,
    private readonly retryConfig: AgentRetryConfigService,
  ) {}

  /**
   * Sends one prompt to the agent, and sends it again when the attempt fails with an error a new attempt can fix
   * (see `isRetryableAgentError`), up to the retries of `AgentRetryConfigService`, waiting twice as long before each
   * one. Every agent goes through here, so the CEO and the delegates alike survive a dropped process or a failed
   * request; the error that ends the last attempt is the one thrown.
   */
  async run(input: AgentRoundInput): Promise<string> {
    const { maxRetries, baseDelayMs } = this.retryConfig.getPolicy();
    let attemptInput = input;
    for (let retry = 1; ; retry++) {
      try {
        return await this.runOnce(attemptInput);
      } catch (error) {
        if (retry > maxRetries || !isRetryableAgentError(error)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const delayMs = baseDelayMs * 2 ** (retry - 1);
        this.logger.warn(`[Agent Retry] Role=${input.role}, Retry=${retry}/${maxRetries}, Delay=${delayMs}ms: ${message}`);
        if (input.role === input.request.agentRole) {
          input.request.onDraft?.('');
        }
        await input.turn.sleep(delayMs);
        attemptInput = { ...input, prompt: buildAgentRetryPrompt(message, input.prompt) };
      }
    }
  }

  /**
   * One attempt: connects the agent, resumes or creates the session the conversation keeps for the role and project,
   * adds the system prompt to a new session, the reminder and the language, applies the role's profile and returns
   * the final response, after one repair when protocol tags were written outside it.
   */
  private async runOnce({
    agentPort,
    cwd: workspacePath,
    role,
    prompt,
    request,
    turn,
    session,
    sessionMode = 'resume',
    projectName,
    isUserMessage = false,
    answerDelivery,
  }: AgentRoundInput): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      turn.throwIfCancelled();

      const reminder = this.agentRegistry.getTurnReminder(role);
      const languagePrompt = await this.buildLanguagePrompt(role, request.agentRole);
      let fullPrompt = [prompt, reminder, languagePrompt].filter(Boolean).join('\n\n');
      let systemPromptPending = isUserMessage && this.agentRegistry.isSystemPromptEveryTurn(role);
      if (!agentPort.currentSessionId) {
        const latest = await this.findLatestSession(session);
        const storedSessionId = sessionMode === 'new'
          ? undefined
          : latest.agentSessions.find(agentSession =>
            this.isSameAgentSession(agentSession, { role, agentId: agentPort.agentName, projectName: projectName ?? null }))?.sessionId;
        const resumed = await this.resumeAgentSession(agentPort, workspacePath, storedSessionId);
        if (!resumed) {
          await this.workspacePort.ensureDirectory(workspacePath);
          await agentPort.createSession(workspacePath);
          systemPromptPending = true;
          if (answerDelivery) {
            fullPrompt = `${buildLostSessionTaskPrompt(answerDelivery.taskSpec)}\n\n${fullPrompt}`;
          }
        }
        const { currentSessionId } = agentPort;
        if (currentSessionId && currentSessionId !== storedSessionId) {
          await this.bindAgentSession(latest, {
            role,
            agentId: agentPort.agentName,
            sessionId: currentSessionId,
            projectName: projectName ?? null,
          });
        }
      }

      if (systemPromptPending) {
        fullPrompt = `${await this.buildSystemPrompt(role)}\n\n${fullPrompt}`;
      }

      await this.applyAgentConfig(agentPort, role, request.conversationId);

      const stream = this.agentProtocol.stream({
        onActivity: activity => request.onActivity?.(activity, role),
        // Only the CEO talks to the user, so the answers other agents write stay out of the draft.
        ...(role === request.agentRole && { onAnswer: answer => request.onDraft?.(this.agentProtocol.visibleReply(answer)) }),
      });
      unsubscribeActivity = agentPort.onActivity(activity => stream.read(activity));

      turn.throwIfCancelled();
      if (answerDelivery) {
        await this.openWork.update(request.conversationId, answerDelivery.workId, { questions: undefined });
      }
      let written = await this.promptAgent(agentPort, fullPrompt);
      const stray = this.agentProtocol.strayTags(written.all);
      if (stray.length > 0) {
        this.logger.warn(`[Protocol Repair] Role=${role}: ${stray.join(', ')} outside the final response`);
        if (role === request.agentRole) {
          request.onDraft?.('');
        }
        turn.throwIfCancelled();
        written = await this.promptAgent(agentPort, buildProtocolRepairPrompt(stray));
      }

      const response = this.agentProtocol.finalResponse(written.last);
      this.logger.log(`[Agent Response] Role=${role}, Length=${response.length}: "${previewForLog(response)}"`);
      return response;
    } finally {
      unsubscribeActivity?.();
    }
  }

  /** `last` is the agent's final message, falling back to everything it wrote; `all` is everything it wrote. */
  private async promptAgent(agentPort: IAgentPort, prompt: string): Promise<{ readonly last: string; readonly all: string }> {
    let all = '';
    for await (const update of agentPort.prompt(prompt)) {
      all += update.text;
    }
    return { last: agentPort.lastAgentMessage || all, all };
  }

  private async resumeAgentSession(
    agentPort: IAgentPort,
    workspacePath: string,
    sessionId: string | undefined,
  ): Promise<boolean> {
    if (!sessionId) {
      return false;
    }
    const loaded = await agentPort.loadSession(workspacePath, sessionId);
    this.logger.log(
      `[Agent Session ${loaded ? 'Resumed' : 'Not Resumed'}] AgentSession=${sessionId}`,
    );
    return loaded;
  }

  private async findLatestSession(session: SessionContext): Promise<SessionContext> {
    return await this.sessionStore.findSession(session.conversationId) ?? session;
  }

  /** Parallel delegations bind their sessions concurrently, so each binding re-reads the stored session in sequence. */
  private async bindAgentSession(session: SessionContext, binding: AgentSession): Promise<void> {
    const bound = this.sessionBindings.then(async () => {
      const latest = await this.findLatestSession(session);
      const others = latest.agentSessions.filter(agentSession => !this.isSameAgentSession(agentSession, binding));
      await this.sessionStore.saveSession({
        ...latest,
        agentSessions: [...others, binding],
      });
    });
    this.sessionBindings = bound.catch(() => undefined);
    await bound;
  }

  private isSameAgentSession(
    agentSession: AgentSession,
    target: Pick<AgentSession, 'role' | 'agentId' | 'projectName'>,
  ): boolean {
    return agentSession.role === target.role
      && agentSession.agentId === target.agentId
      && agentSession.projectName === target.projectName;
  }

  private async applyAgentConfig(agentPort: IAgentPort, role: string, conversationId: string): Promise<void> {
    const profile = await this.findAgentProfile(agentPort, role, conversationId);
    if (profile?.modelId) {
      await agentPort.setConfig({
        modelId: profile.modelId,
        effortId: profile.effortId ?? undefined,
      });
      return;
    }

    const defaultModel = this.agentRegistry.getDefaultModel(role);
    if (defaultModel) {
      await agentPort.setConfig({ modelId: defaultModel });
    }
  }

  /** Settings saved for another agent carry model ids that this agent does not know. */
  private async findAgentProfile(
    agentPort: IAgentPort,
    role: string,
    conversationId: string,
  ): Promise<AgentProfileSettings | undefined> {
    const profile = await this.findProfile(conversationId, role);
    return profile?.agentId === agentPort.agentName ? profile : undefined;
  }

  /** Read at every turn and delegation start, so a saved change applies to the next one without interrupting any. */
  async resolveAgentId(conversationId: string, role: string): Promise<string> {
    return (await this.findProfile(conversationId, role))?.agentId ?? this.agentPortFactory.defaultAgentId;
  }

  private async findProfile(conversationId: string, role: string): Promise<AgentProfileSettings | undefined> {
    const settings = await this.settingsStore.load(conversationId);
    return settings ? resolveProfile(settings, role) : undefined;
  }

  async buildAgentInfo(agentPort: IAgentPort, role: string, conversationId: string): Promise<TurnAgentInfo> {
    const profile = await this.findAgentProfile(agentPort, role, conversationId);
    return {
      roleName: this.agentRegistry.getDisplayName(role),
      agentName: agentPort.agentName,
      modelName: profile?.modelName ?? this.currentModelName(agentPort),
      effortName: profile?.effortName ?? undefined,
    };
  }

  private currentModelName(agentPort: IAgentPort): string | undefined {
    const state = agentPort.getAvailableModels();
    return state?.availableModels.find(model => model.modelId === state.currentModelId)?.displayName;
  }

  /** The system prompt of the role, followed by the catalog of its skills when it has any or writes them. */
  private async buildSystemPrompt(role: string): Promise<string> {
    const skills = await this.agentSkills.list(role);
    const writesSkills = this.agentSkills.writesSkills(role);
    const systemPrompt = this.agentRegistry.getSystemPrompt(role);
    return skills.length > 0 || writesSkills ? `${systemPrompt}\n\n${buildSkillCatalogPrompt(skills, writesSkills)}` : systemPrompt;
  }

  /** The CEO talks to the user on behalf of the team, so only its prompts carry the language detection. */
  async buildLanguagePrompt(role: string, ceoRole: string): Promise<string> {
    const { language } = await this.preferencesStore.load();
    if (role !== ceoRole) {
      return buildAgentLanguagePrompt(language ?? DEFAULT_USER_LANGUAGE);
    }
    return language ? buildCeoLanguagePrompt(language) : buildLanguageDetectionPrompt();
  }

  /** The conversation's stored session, created empty on its first turn. */
  async resolveSession(request: TurnRequest): Promise<SessionContext> {
    const existing = await this.sessionStore.findSession(request.conversationId);
    if (existing) {
      return existing;
    }
    const session: SessionContext = { conversationId: request.conversationId, agentSessions: [] };
    await this.sessionStore.saveSession(session);
    return session;
  }
}
