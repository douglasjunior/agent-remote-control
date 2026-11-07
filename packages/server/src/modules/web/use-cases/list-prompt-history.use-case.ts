import { Inject, Injectable } from '@nestjs/common';

import { IPromptHistoryPort } from '../ports/prompt-history.port.js';


@Injectable()
export class ListPromptHistoryUseCase {
  constructor(@Inject(IPromptHistoryPort) private readonly history: IPromptHistoryPort) {}

  execute(): Promise<readonly string[]> {
    return this.history.list();
  }
}
