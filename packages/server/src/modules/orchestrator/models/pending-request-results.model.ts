/** A response without its artifact requests, and their results when they wait for the agent's next prompt. */
export type ResolvedResponse = { readonly response: string; readonly requestResults?: string };

/** The results of artifact requests that went with an outcome, delivered at the head of the agent's next prompt. */
export class PendingRequestResults {
  private results: string | undefined;

  keep({ response, requestResults }: ResolvedResponse): string {
    this.results = requestResults;
    return response;
  }

  before(prompt: string): string {
    const results = this.take();
    return results ? `${results}\n\n${prompt}` : prompt;
  }

  take(): string | undefined {
    const results = this.results;
    this.results = undefined;
    return results;
  }
}
