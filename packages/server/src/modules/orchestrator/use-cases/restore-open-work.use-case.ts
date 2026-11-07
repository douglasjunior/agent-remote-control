import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { OpenWorkService } from '../services/open-work.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';


/** Puts the questions a restart left unanswered back in the queue, before any channel accepts a connection. */
@Injectable()
export class RestoreOpenWorkUseCase implements OnModuleInit {
  private readonly logger = new Logger(RestoreOpenWorkUseCase.name);

  constructor(
    private readonly openWork: OpenWorkService,
    private readonly questionQueue: UserQuestionQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.openWork.load();
    for (const conversationId of this.openWork.conversations()) {
      for (const record of this.openWork.interrupted(conversationId)) {
        const { questions } = record;
        if (!questions) {
          continue;
        }
        this.questionQueue.restore(
          conversationId,
          record.id,
          { role: record.role, roleName: record.roleName, projectName: record.projectName },
          questions,
          answers => void this.openWork.update(conversationId, record.id, { questions: { ...questions, answers } }),
        );
      }
      this.logger.log(`[Open Work Restored] Conversation=${conversationId}, Records=${this.openWork.interrupted(conversationId).length}`);
    }
  }
}
