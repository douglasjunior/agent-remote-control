import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AudioTranscript } from '../models/audio-transcription.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { AnsweredQuestion, QuestionAsker, UserQuestion } from '../models/user-question.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { buildQuestionNotAllowedPrompt, buildQuestionRepairPrompt } from '../prompts/question-repair.prompt.js';
import { buildUserAnswersPrompt } from '../prompts/user-answers.prompt.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';

import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


const MAX_REPAIR_ATTEMPTS = 1;

/** Carries the questions an agent asks to the user and the answers back to the agent. */
@Injectable()
export class AnswerAgentQuestionsUseCase {
  private readonly logger = new Logger(AnswerAgentQuestionsUseCase.name);

  constructor(
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    private readonly questionParser: QuestionParserService,
    private readonly questionQueue: UserQuestionQueueService,
    private readonly openWork: OpenWorkService,
    private readonly audioTranscription: TranscribeAudioAttachmentsUseCase,
  ) {}

  /**
   * Answers the questions in an agent response until it gives one without them: valid questions of a role that asks
   * the user go to the user and the answers back to the agent; invalid ones, or any from a role that does not ask,
   * get one repair prompt.
   */
  async execute(
    firstResponse: string,
    runAgent: (text: string) => Promise<string>,
    asker: QuestionAsker,
    request: TurnRequest,
    workId: string | undefined,
  ): Promise<string> {
    let response = firstResponse;
    let repairs = 0;
    const asksUser = this.agentRegistry.getDelegationContract(asker.role).asksUser === true;
    for (;;) {
      const parsed = this.questionParser.parse(response);
      if (parsed.kind === 'none') {
        return response;
      }
      if (parsed.kind === 'invalid' || !asksUser) {
        if (repairs === MAX_REPAIR_ATTEMPTS) {
          return response;
        }
        repairs++;
        const reason = parsed.kind === 'invalid' ? parsed.reason : 'the role does not ask the user';
        this.logger.warn(`[Question Repair] Role=${asker.role}, Attempt=${repairs}: ${reason}`);
        response = await runAgent(parsed.kind === 'invalid' ? buildQuestionRepairPrompt(parsed.reason) : buildQuestionNotAllowedPrompt());
        continue;
      }
      repairs = 0;
      const answers = await this.ask(request, asker, parsed.message, parsed.questions, workId);
      response = await runAgent(buildUserAnswersPrompt(answers));
    }
  }

  /** Queues the questions for the user and keeps them on the open work, so a restart can ask them again. */
  async ask(
    request: TurnRequest,
    asker: QuestionAsker,
    message: string,
    questions: readonly UserQuestion[],
    workId: string | undefined,
  ): Promise<readonly AnsweredQuestion[]> {
    this.logger.log(`[Questions Asked] Conversation=${request.conversationId}, Role=${asker.role}, Questions=${questions.length}`);
    const { conversationId } = request;
    if (workId) {
      await this.openWork.update(conversationId, workId, { questions: { message, questions, answers: [] } });
    }
    const answers = await this.questionQueue.ask(
      conversationId,
      asker,
      message,
      questions,
      {
        asked: prompt => request.onQuestion?.({ kind: 'asked', prompt }),
        timedOut: event => request.onQuestion?.({ kind: 'timedOut', ...event }),
        ...(workId && {
          answersChanged: (answered: readonly AnsweredQuestion[]) =>
            void this.openWork.update(conversationId, workId, { questions: { message, questions, answers: answered } }),
        }),
      },
    );
    if (workId) {
      await this.openWork.update(conversationId, workId, { questions: undefined });
    }
    return this.transcribe(request, answers);
  }

  /** An answer spoken as audio reaches the asking agent as text, like a spoken message does. */
  async transcribe(
    request: TurnRequest,
    answers: readonly AnsweredQuestion[],
  ): Promise<readonly AnsweredQuestion[]> {
    const transcripts: AudioTranscript[] = [];
    const warnings: string[] = [];
    const transcribed: AnsweredQuestion[] = [];
    for (const { attachments, ...answered } of answers) {
      const result = await this.audioTranscription.execute({ prompt: answered.answer, attachments });
      transcripts.push(...result.transcripts);
      warnings.push(...result.warnings);
      transcribed.push({
        ...answered,
        answer: result.prompt,
        ...(result.attachments.length > 0 && { attachments: result.attachments }),
      });
    }
    if (transcripts.length > 0 || warnings.length > 0) {
      request.onTranscription?.({ transcripts, warnings });
    }
    return transcribed;
  }

  askerFor(role: string, projectName: string | undefined): QuestionAsker {
    return { role, roleName: this.agentRegistry.getDisplayName(role), projectName: projectName ?? null };
  }
}
