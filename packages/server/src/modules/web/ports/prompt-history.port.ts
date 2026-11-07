export interface IPromptHistoryPort {
  /** Most recent first. */
  list(): Promise<readonly string[]>;
  /** Moves a prompt equal to the latest one to the front instead of repeating it. */
  append(prompt: string): Promise<void>;
}

export const IPromptHistoryPort = Symbol('IPromptHistoryPort');
