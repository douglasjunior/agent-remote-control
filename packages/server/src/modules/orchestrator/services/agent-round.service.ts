import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { AgentMcpServer, AgentUsage, IAgentPort } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentInterface } from '../models/agent-interface.model.js';
import type { AgentRequester } from '../models/agent-request.model.js';
import type { AgentSession, OpenedAgentSession } from '../models/agent-session.model.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { AgentToolSession } from '../models/agent-tool.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { AnswerDelivery } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { IAgentSkillsPort } from '../ports/agent-skills.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildFinalResponseCountRepairPrompt, buildProtocolRepairPrompt } from '../prompts/protocol-repair.prompt.js';
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

import { AgentProtocolService } from './agent-protocol.service.js';
import { AgentRequestParserService } from './agent-request-parser.service.js';
import { AgentToolSessionsService } from './agent-tool-sessions.service.js';
import { OpenWorkService } from './open-work.service.js';
import { SteeringSupportService } from './steering-support.service.js';


/** A prompt that depends on the session the agent reached, built once the round knows it. */
export type AgentPrompt = string | ((session: OpenedAgentSession) => Promise<string>);

/** What identifies the session of a role, agent, project and artifact. */
type AgentSessionKey = Pick<AgentSession, 'role' | 'agentId' | 'projectName' | 'artifactId'>;

export type AgentRoundInput = {
  readonly agentPort: IAgentPort;
  /** The folder the session of the agent runs in. */
  readonly cwd: string;
  readonly role: string;
  /** The agent its requests and tools act for. */
  readonly requester: AgentRequester;
  readonly prompt: AgentPrompt;
  readonly request: TurnRequest;
  readonly turn: ActiveTurn;
  readonly session: SessionContext;
  /** `new` skips the stored session of the role and starts another in its place. */
  readonly sessionMode?: 'resume' | 'new';
  readonly projectName?: string;
  /** The task the agent works on, which has a session of its own. */
  readonly artifactId?: string;
  /** A message the user wrote, which brings the CEO its system prompt again when it gets one every turn. */
  readonly isUserMessage?: boolean;
  readonly answerDelivery?: AnswerDelivery;
  /** Hears what each prompt of the round cost, for whoever adds up a delegation. */
  readonly onPrompt?: (cost: AgentPromptCost) => void;
};

export type AgentPromptCost = {
  readonly promptChars: number;
  readonly responseChars: number;
  readonly usage?: AgentUsage;
};

/** Runs the prompts of one agent in the session the conversation keeps for its role, project and task, with the role's profile. */
@Injectable()
export class AgentRoundService {
  private readonly logger = new Logger(AgentRoundService.name);
  /** The ports whose session is still marked `unanswered` on its binding. */
  private readonly unanswered = new WeakSet<IAgentPort>();

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
    private readonly requestParser: AgentRequestParserService,
    private readonly toolSessions: AgentToolSessionsService,
    private readonly steeringSupport: SteeringSupportService,
  ) {}

  /**
   * Sends one prompt to the agent in its session: connects it, resumes or creates the session the conversation keeps
   * for the role, project and task, puts the system prompt in front of a new session's prompt and the re-entry note and
   * the current skill catalog of the role in front of a resumed one's, adds the language, applies the role's profile and returns the final response. A
   * session it creates or loads gets the agent tools of the requester when the agent takes them, and the system prompt,
   * re-entry note and skill catalog are written for the interface of the session. Requests
   * written outside the final response go in front of it, as written, for the caller to carry out with the rest; any
   * other protocol tag written there, or more than one final response block, gets one repair prompt.
   */
  async run({
    agentPort,
    cwd: workspacePath,
    role,
    requester,
    prompt,
    request,
    turn,
    session,
    sessionMode = 'resume',
    projectName,
    artifactId,
    isUserMessage = false,
    answerDelivery,
    onPrompt,
  }: AgentRoundInput): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      this.steeringSupport.record(agentPort.agentName, agentPort.supportsSteering);
      turn.throwIfCancelled();

      const toolSession: AgentToolSession = { requester, onSkill: activity => request.onActivity?.(activity, requester.role) };
      const key: AgentSessionKey = { role, agentId: agentPort.agentName, projectName: projectName ?? null, artifactId: artifactId ?? null };
      let opened: OpenedAgentSession;
      if (agentPort.currentSessionId) {
        this.toolSessions.update(agentPort, toolSession);
        opened = { state: this.unanswered.has(agentPort) ? 'new' : 'live' };
      } else {
        opened = await this.openSession(agentPort, workspacePath, session, sessionMode, key, this.toolSessions.open(agentPort, toolSession));
      }
      const sessionState = opened.state;
      const agentInterface = this.interfaceOf(agentPort);
      const systemPromptPending = sessionState === 'new' || (isUserMessage && this.agentRegistry.isSystemPromptEveryTurn(role));
      const fullPrompt = [
        systemPromptPending ? await this.buildSystemPrompt(role, agentInterface) : '',
        sessionState === 'resumed' ? this.agentRegistry.getReentryNote(role, agentInterface) : '',
        sessionState === 'resumed' && !systemPromptPending ? await this.buildSkillCatalog(role, agentInterface) : '',
        sessionState === 'new' && answerDelivery ? buildLostSessionTaskPrompt(answerDelivery.taskSpec, answerDelivery.updates) : '',
        typeof prompt === 'string' ? prompt : await prompt(opened),
        await this.buildLanguagePrompt(role, request.agentRole),
      ].filter(Boolean).join('\n\n');

      await this.applyAgentConfig(agentPort, role, request.conversationId);

      const stream = this.agentProtocol.stream({
        onActivity: activity => request.onActivity?.(activity, role),
        // Only the CEO talks to the user, so the answers other agents write stay out of the draft.
        ...(role === request.agentRole && { onAnswer: answer => request.onDraft?.(this.agentProtocol.visibleReply(answer)) }),
      });
      let answerRecorded: Promise<void> | undefined;
      const hearAnswer = (): void => {
        if (this.unanswered.delete(agentPort)) {
          answerRecorded = this.recordAnswered(session, agentPort, key).catch((error: unknown) => {
            this.logger.error(`[Session Record Failed] Role=${role}: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
      };
      unsubscribeActivity = agentPort.onActivity((activity) => {
        // Recorded at the first sign, so a restart in the middle of the prompt finds a session that knows its work.
        if (activity.kind === 'thought' || activity.kind === 'tool') {
          hearAnswer();
        }
        stream.read(activity);
      });

      turn.throwIfCancelled();
      if (answerDelivery) {
        await this.openWork.update(request.conversationId, answerDelivery.workId, { questions: undefined });
      }
      this.logger.log(`[Agent Prompt] Role=${role}, Session=${sessionState}, Interface=${agentInterface}, SystemPrompt=${systemPromptPending ? 'yes' : 'no'}, Chars=${fullPrompt.length}`);
      let written = await this.promptAgent(agentPort, fullPrompt, role, onPrompt);
      hearAnswer();
      await answerRecorded;
      let strayRequests = '';
      let repairPrompt: string | undefined;
      const blocks = this.agentProtocol.finalResponseBlocks(written.last);
      if (blocks > 1) {
        this.logger.warn(`[Protocol Repair] Role=${role}: ${blocks} final response blocks`);
        repairPrompt = buildFinalResponseCountRepairPrompt(blocks);
      } else {
        const stray = this.agentProtocol.strayTags(written.all);
        if (stray.length > 0 && stray.every(tag => this.isRequestTag(tag))) {
          this.logger.log(`[Stray Requests] Role=${role}: ${stray.join(', ')} outside the final response, carried out`);
          strayRequests = this.strayRequests(written.all, this.agentProtocol.finalResponse(written.last));
        } else if (stray.length > 0) {
          this.logger.warn(`[Protocol Repair] Role=${role}: ${stray.join(', ')} outside the final response`);
          repairPrompt = buildProtocolRepairPrompt(stray);
        }
      }
      if (repairPrompt !== undefined) {
        if (role === request.agentRole) {
          request.onDraft?.('');
        }
        turn.throwIfCancelled();
        written = await this.promptAgent(agentPort, repairPrompt, role, onPrompt);
      }

      const finalResponse = this.agentProtocol.finalResponse(written.last);
      const response = strayRequests ? `${strayRequests}\n\n${finalResponse}` : finalResponse;
      this.logger.log(`[Agent Response] Role=${role}, Length=${response.length}: "${previewForLog(response)}"`);
      this.logger.log(`[Agent Response Text] Role=${role}, Length=${response.length}:\n${response}`);
      return response;
    } finally {
      unsubscribeActivity?.();
    }
  }

  /**
   * The requests written outside the final response, as written, leaving out each one the final response also
   * carries: an agent that writes a request in both places means it once.
   */
  private strayRequests(written: string, finalResponse: string): string {
    const rawOf = (text: string): readonly string[] => {
      const parsed = this.requestParser.parse(text);
      return parsed.kind === 'requests' ? parsed.raw : [];
    };
    const normalize = (request: string) => request.replace(/\s+/g, ' ').trim();
    const inside = new Set(rawOf(finalResponse).map(normalize));
    return rawOf(this.agentProtocol.narration(written)).filter(request => !inside.has(normalize(request))).join('\n');
  }

  private isRequestTag(tag: string): boolean {
    return tag.startsWith('artifact_') || tag.startsWith('skill_');
  }

  /**
   * Loads the stored session of the key, or creates one in its place, both with `mcpServers`, and stores the id the port
   * ends up with. The session is stored before its first prompt, which a restart may interrupt, so its binding stays
   * marked `unanswered` until the agent shows itself at work on one.
   */
  private async openSession(
    agentPort: IAgentPort,
    workspacePath: string,
    session: SessionContext,
    sessionMode: 'resume' | 'new',
    key: AgentSessionKey,
    mcpServers: readonly AgentMcpServer[],
  ): Promise<OpenedAgentSession> {
    const latest = await this.findLatestSession(session);
    const stored = sessionMode === 'new'
      ? undefined
      : latest.agentSessions.find(agentSession => this.isSameAgentSession(agentSession, key));
    const resumed = await this.resumeAgentSession(agentPort, workspacePath, stored?.sessionId, mcpServers);
    if (!resumed) {
      await this.workspacePort.ensureDirectory(workspacePath);
      await agentPort.createSession(workspacePath, { mcpServers });
    }
    const unanswered = !resumed || stored?.unanswered === true;
    const { currentSessionId } = agentPort;
    if (currentSessionId && currentSessionId !== stored?.sessionId) {
      await this.bindAgentSession(latest, { ...key, sessionId: currentSessionId, ...(unanswered && { unanswered }) });
    }
    if (unanswered) {
      this.unanswered.add(agentPort);
      return { state: 'new' };
    }
    return stored?.workEndedAt ? { state: 'resumed', workEndedAt: stored.workEndedAt } : { state: 'resumed' };
  }

  /** Takes the `unanswered` mark off the binding of the session the port holds, unless another session replaced it in the store. */
  private async recordAnswered(session: SessionContext, agentPort: IAgentPort, key: AgentSessionKey): Promise<void> {
    const sessionId = agentPort.currentSessionId;
    await this.updateBinding(session, (latest) => {
      const binding = latest.agentSessions.find(agentSession => this.isSameAgentSession(agentSession, key) && agentSession.sessionId === sessionId);
      if (!binding) {
        return undefined;
      }
      const { unanswered, ...answered } = binding;
      return unanswered ? answered : undefined;
    });
  }

  /**
   * Records on the session the port holds that its work on the artifact of `key` ended now, so the delegation that
   * resumes it next is told what changed since. A port without a session, or whose session another one replaced in
   * the store for the key, records nothing.
   */
  async recordWorkEnded(session: SessionContext, agentPort: IAgentPort, key: AgentSessionKey): Promise<void> {
    const sessionId = agentPort.currentSessionId;
    await this.updateBinding(session, (latest) => {
      const binding = latest.agentSessions.find(agentSession => this.isSameAgentSession(agentSession, key) && agentSession.sessionId === sessionId);
      return binding && { ...binding, workEndedAt: new Date().toISOString() };
    });
  }

  /** `last` is the agent's final message, falling back to everything it wrote; `all` is everything it wrote. */
  private async promptAgent(
    agentPort: IAgentPort,
    prompt: string,
    role: string,
    onPrompt: AgentRoundInput['onPrompt'],
  ): Promise<{ readonly last: string; readonly all: string }> {
    let all = '';
    for await (const update of agentPort.prompt(prompt)) {
      all += update.text;
    }
    const usage = await agentPort.getLastRoundUsage().catch(() => undefined);
    if (usage) {
      this.logger.log(`[Agent Usage] Role=${role}, Input=${usage.inputTokens}, Output=${usage.outputTokens}, CachedRead=${usage.cachedReadTokens ?? 0}, CachedWrite=${usage.cachedWriteTokens ?? 0}, Total=${usage.totalTokens}`);
    }
    onPrompt?.({ promptChars: prompt.length, responseChars: all.length, ...(usage ? { usage } : {}) });
    return { last: agentPort.lastAgentMessage || all, all };
  }

  private async resumeAgentSession(
    agentPort: IAgentPort,
    workspacePath: string,
    sessionId: string | undefined,
    mcpServers: readonly AgentMcpServer[],
  ): Promise<boolean> {
    if (!sessionId) {
      return false;
    }
    const loaded = await agentPort.loadSession(workspacePath, sessionId, { mcpServers });
    this.logger.log(
      `[Agent Session ${loaded ? 'Resumed' : 'Not Resumed'}] AgentSession=${sessionId}`,
    );
    return loaded;
  }

  private async findLatestSession(session: SessionContext): Promise<SessionContext> {
    return await this.sessionStore.findSession(session.conversationId) ?? session;
  }

  private async bindAgentSession(session: SessionContext, binding: AgentSession): Promise<void> {
    await this.updateBinding(session, () => binding);
  }

  /** `change` returns the binding that takes the place of the one with its key, or nothing to leave them as they are. */
  private async updateBinding(session: SessionContext, change: (latest: SessionContext) => AgentSession | undefined): Promise<void> {
    await this.sessionStore.updateSession(session.conversationId, (latest) => {
      const binding = change(latest);
      if (!binding) {
        return undefined;
      }
      const others = latest.agentSessions.filter(agentSession => !this.isSameAgentSession(agentSession, binding));
      return { ...latest, agentSessions: [...others, binding] };
    });
  }

  private isSameAgentSession(agentSession: AgentSession, target: AgentSessionKey): boolean {
    return agentSession.role === target.role
      && agentSession.agentId === target.agentId
      && agentSession.projectName === target.projectName
      && agentSession.artifactId === target.artifactId;
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

  /** The interface of the session the port holds, which the prompts it receives and the skills it reads are written for. */
  interfaceOf(agentPort: IAgentPort): AgentInterface {
    return this.toolSessions.interfaceOf(agentPort);
  }

  /** The system prompt of the role, followed by the catalog of its skills when it has any or writes them. */
  private async buildSystemPrompt(role: string, agentInterface: AgentInterface): Promise<string> {
    return [this.agentRegistry.getSystemPrompt(role, agentInterface), await this.buildSkillCatalog(role, agentInterface)].filter(Boolean).join('\n\n');
  }

  /** The skills the role may read now, or nothing for a role without skills that does not write them. */
  private async buildSkillCatalog(role: string, agentInterface: AgentInterface): Promise<string> {
    const skills = await this.agentSkills.list(role);
    const writesSkills = this.agentSkills.writesSkills(role);
    return skills.length > 0 || writesSkills ? buildSkillCatalogPrompt(skills, agentInterface, writesSkills) : '';
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
    return existing ?? this.sessionStore.updateSession(request.conversationId, session => session);
  }
}
