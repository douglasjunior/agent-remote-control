import type { DelegationOutcome } from './running-delegations.model.js';
import type { TurnRequest } from './turn-request.model.js';


/** How a delegation ended, which decides what becomes of the instructions still waiting for it. */
export type DelegationEnd = 'finished' | 'failed' | 'stopped' | 'replaced' | 'cancelled';

/** A text the CEO sent to an agent already at work, with the summary the user reads about it. */
export type DelegationInstruction = {
  readonly text: string;
  readonly summary: string;
};

/** An instruction on the same work, run in the agent's session as a prompt of its own once the current run has its result. */
export type FollowUp = {
  readonly instruction: DelegationInstruction;
  /** The turn that sent it, which gets its result. */
  readonly request: TurnRequest;
  readonly round: number;
  settle(outcome: DelegationOutcome): void;
};

/**
 * What reaches a running delegation between its prompts: instructions kept for its next prompt, the interruption that
 * makes that prompt come at once, and follow-ups that run after the current run. A run that is finishing takes no more
 * instructions, so none is kept where no prompt would deliver it; a delegation that is closing takes no more follow-ups.
 */
export class DelegationControl {
  private kept: DelegationInstruction[] = [];
  private interrupted = false;
  private sealed = false;
  private closed = false;
  private readonly followUps: FollowUp[] = [];
  private waiters = 0;
  private currentSummary: string;
  private readonly instructions: string[];
  private resolveEnded!: (end: DelegationEnd) => void;
  /** Resolves once the delegation has released its artifact and closed its agent. */
  readonly ended = new Promise<DelegationEnd>((resolve) => {
    this.resolveEnded = resolve;
  });

  /** The event id of the run in progress. */
  runId: string;
  /** Since when the agent has not been told what changed on its artifact. */
  contextSince: string;

  constructor(options: { readonly runId: string; readonly summary: string; readonly updates?: readonly string[]; readonly contextSince: string }) {
    this.runId = options.runId;
    this.currentSummary = options.summary;
    this.instructions = [...options.updates ?? []];
    this.contextSince = options.contextSince;
  }

  get summary(): string {
    return this.currentSummary;
  }

  /** Every instruction the agent received after its task, in order. */
  get updates(): readonly string[] {
    return this.instructions;
  }

  /** Follow-ups and delegations waiting for this agent. */
  get queued(): number {
    return this.followUps.length + this.waiters;
  }

  get acceptsInstructions(): boolean {
    return !this.sealed;
  }

  /** Records an instruction the agent received or will receive, whose summary becomes the one the user reads. */
  record({ text, summary }: DelegationInstruction): void {
    this.instructions.push(text);
    this.currentSummary = summary;
  }

  /** Keeps an instruction for the next prompt of the run; `false` once the run is finishing. */
  keep(instruction: DelegationInstruction, interrupt = false): boolean {
    if (this.sealed) {
      return false;
    }
    this.kept.push(instruction);
    this.interrupted ||= interrupt;
    return true;
  }

  /** Hands the kept instructions to the prompt being written, which also settles the interruption they asked for. */
  take(): readonly DelegationInstruction[] {
    const taken = this.kept;
    this.kept = [];
    this.interrupted = false;
    return taken;
  }

  /** Whether a prompt was cancelled to deliver kept instructions at once. */
  takeInterruption(): boolean {
    const interrupted = this.interrupted;
    this.interrupted = false;
    return interrupted;
  }

  /** Ends the run when nothing is kept for another prompt; `false` when kept instructions still need one. */
  seal(): boolean {
    if (this.kept.length > 0) {
      return false;
    }
    this.sealed = true;
    return true;
  }

  /** `false` once the delegation is closing, when the follow-up must wait for it to end instead. */
  follow(followUp: FollowUp): boolean {
    if (this.closed) {
      return false;
    }
    this.followUps.push(followUp);
    return true;
  }

  /** Takes back a follow-up that has not started; `false` when it already did. */
  withdraw(followUp: FollowUp): boolean {
    const index = this.followUps.indexOf(followUp);
    if (index < 0) {
      return false;
    }
    this.followUps.splice(index, 1);
    return true;
  }

  /** The next follow-up, which opens a run; without one the delegation closes to new follow-ups. */
  next(): FollowUp | undefined {
    const followUp = this.followUps.shift();
    if (followUp) {
      this.sealed = false;
    } else {
      this.closed = true;
    }
    return followUp;
  }

  /** Counts a delegation waiting for this one to end, until the returned function is called. */
  addWaiter(): () => void {
    this.waiters++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.waiters--;
      }
    };
  }

  /** Closes the delegation to new follow-ups and hands back the ones that never ran. */
  close(): readonly FollowUp[] {
    this.closed = true;
    this.sealed = true;
    return this.followUps.splice(0);
  }

  finish(end: DelegationEnd): void {
    this.resolveEnded(end);
  }
}
