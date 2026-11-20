export type DelegationOutcome =
  | { readonly kind: 'result'; readonly block: string }
  | { readonly kind: 'cancelled'; readonly reason: unknown }
  /** A later delegation replaced the agent, and that one gives the result. */
  | { readonly kind: 'replaced' }
  /** The instruction joined the run already under way, whose result answers it. */
  | { readonly kind: 'merged' };

export interface StartedDelegation {
  readonly outcome: Promise<DelegationOutcome>;
  /** Stops the work while its outcome is pending, so no agent runs on for a turn that ended. */
  cancel(): Promise<void>;
}

type HandedOver = Extract<DelegationOutcome, { readonly kind: 'result' | 'cancelled' }>;

/**
 * Delegations a turn has started and not yet handed to the CEO. Results are handed over in the order the
 * agents finish, and the ones that finish while the CEO is busy come out together in the next batch.
 */
export class RunningDelegations {
  private readonly pending = new Map<Promise<void>, () => Promise<void>>();
  private finished: HandedOver[] = [];

  get isEmpty(): boolean {
    return this.pending.size === 0 && this.finished.length === 0;
  }

  add(started: readonly StartedDelegation[]): void {
    for (const { outcome, cancel } of started) {
      const tracked: Promise<void> = outcome.then((settled) => {
        this.pending.delete(tracked);
        if (settled.kind === 'result' || settled.kind === 'cancelled') {
          this.finished.push(settled);
        }
      });
      this.pending.set(tracked, cancel);
    }
  }

  /**
   * Waits for at least one result and returns every result finished so far; a cancellation is thrown. Returns
   * `undefined` when nothing is left to wait for, because every agent still running was replaced or took the work into
   * a run another turn waits for.
   */
  async nextResults(): Promise<string | undefined> {
    while (this.finished.length === 0) {
      if (this.pending.size === 0) {
        return undefined;
      }
      await Promise.race(this.pending.keys());
    }
    const batch = this.finished;
    this.finished = [];
    const blocks: string[] = [];
    for (const outcome of batch) {
      if (outcome.kind === 'cancelled') {
        throw outcome.reason;
      }
      blocks.push(outcome.block);
    }
    return blocks.join('\n\n');
  }

  /** Cancels every delegation whose outcome is still pending and waits for them all to settle. */
  async cancelPending(): Promise<void> {
    await Promise.allSettled([...this.pending.values()].map(cancel => cancel()));
    await this.settled();
  }

  async settled(): Promise<void> {
    await Promise.allSettled(this.pending.keys());
  }
}
