import { Inject, Injectable } from '@nestjs/common';

import { ACTIVE_TASK_STATUSES } from '../../artifacts/constants/artifact-catalog.constant.js';
import { IArtifactsPort } from '../../artifacts/ports/artifacts.port.js';
import { type BoardCheckTask, buildBoardPrompt } from '../prompts/board.prompt.js';

import { ArtifactPromptFormatterService } from './artifact-prompt-formatter.service.js';


/** What the CEO sees of the board of its conversation: the `[BOARD]` block and the tasks a turn would leave behind. */
@Injectable()
export class CeoBoardService {
  constructor(
    @Inject(IArtifactsPort) private readonly artifacts: IArtifactsPort,
    private readonly formatter: ArtifactPromptFormatterService,
  ) {}

  async buildPrompt(conversationId: string): Promise<string> {
    return buildBoardPrompt(this.formatter.digest(await this.artifacts.list(conversationId, { statuses: 'all' })));
  }

  /**
   * Tasks in the middle of the flow that no agent holds and that `answer` does not name: nobody would move them on
   * once the turn ends. A task the answer names is one the CEO already accounted for to the user.
   */
  async findStranded(conversationId: string, answer: string): Promise<readonly BoardCheckTask[]> {
    const tasks = await this.artifacts.list(conversationId, { types: ['task'], statuses: 'all' });
    return tasks
      .filter(task => ACTIVE_TASK_STATUSES.includes(task.status) && !task.assignee && !this.names(answer, task.id))
      .map(({ id, title, status }) => ({ id, title, status }));
  }

  /** As a whole id, so T-1 is not found inside T-10. */
  private names(answer: string, id: string): boolean {
    return new RegExp(`(?<![\\w-])${id}(?![\\w-])`, 'i').test(answer);
  }
}
