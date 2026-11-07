import type { IPromptHistoryPort } from '../ports/prompt-history.port.js';


export class FakePromptHistory implements IPromptHistoryPort {
  /** Most recent first. */
  prompts: string[] = [];

  async list(): Promise<readonly string[]> {
    return [...this.prompts];
  }

  async append(prompt: string): Promise<void> {
    if (this.prompts[0] !== prompt) {
      this.prompts.unshift(prompt);
    }
  }
}
