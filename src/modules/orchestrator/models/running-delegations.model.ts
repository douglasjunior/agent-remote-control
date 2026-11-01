export type DelegationOutcome =
  | { readonly kind: 'result'; readonly block: string }
  | { readonly kind: 'cancelled'; readonly reason: unknown };

export interface StartedDelegation {
  readonly role: string;
  readonly outcome: Promise<DelegationOutcome>;
}

/**
 * Delegations a turn has started and not yet handed to the CEO. Results are handed over in the order the
 * agents finish, and the ones that finish while the CEO is busy come out together in the next batch.
 */
export class RunningDelegations {
  private readonly pending = new Map<Promise<void>, string>();
  private finished: DelegationOutcome[] = [];

  get isEmpty(): boolean {
    return this.pending.size === 0 && this.finished.length === 0;
  }

  get pendingRoles(): readonly string[] {
    return [...this.pending.values()];
  }

  add(started: readonly StartedDelegation[]): void {
    for (const { role, outcome } of started) {
      const tracked: Promise<void> = outcome.then((settled) => {
        this.pending.delete(tracked);
        this.finished.push(settled);
      });
      this.pending.set(tracked, role);
    }
  }

  /** Waits for at least one result and returns every result finished so far; a cancellation is thrown. */
  async nextResults(): Promise<string> {
    while (this.finished.length === 0) {
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

  async settled(): Promise<void> {
    await Promise.allSettled(this.pending.keys());
  }
}
