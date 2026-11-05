import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export type ActivityEntry = Extract<ConversationEntry, { type: 'thought' | 'tool' }>;
type DelegationEntry = Extract<ConversationEntry, { type: 'delegation' }>;

export type HandoffStatus = 'working' | 'done' | 'failed';

/** One delegation, from the entry that started it to the entry that closed it. */
export interface Handoff {
  readonly id: string;
  /** Pairs the start of the delegation with its end; unique across the conversation, unlike `round`. */
  readonly delegationId: string;
  readonly round: number;
  readonly role: string;
  readonly roleName: string;
  readonly summary: string;
  /** What the CEO wrote for the agent. */
  readonly prompt: string;
  readonly projectName?: string;
  readonly status: HandoffStatus;
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly response?: string;
  readonly errorMessage?: string;
  /** The thoughts and tool calls of the agent while it worked on this delegation. */
  readonly steps: readonly ActivityEntry[];
}

/** What the team did in a turn, noted on the answer that closes it. */
export interface TeamRecap {
  readonly agents: number;
  readonly totalMs: number;
}

export type EntryItem =
  | { readonly kind: 'entry'; readonly entry: Exclude<ConversationEntry, ActivityEntry | DelegationEntry>; readonly recap?: TeamRecap }
  | { readonly kind: 'activity'; readonly id: string; readonly steps: readonly ActivityEntry[] }
  | { readonly kind: 'squad'; readonly id: string; readonly handoffs: readonly Handoff[] };

export function itemId(item: EntryItem): string {
  return item.kind === 'entry' ? item.entry.id : item.id;
}

const isCoordinator = (role: string) => role === 'CEO';

/** The steps of every delegated agent, filed under the delegation that was running for its role when they happened. */
function stepsByDelegation(entries: readonly ConversationEntry[]): ReadonlyMap<string, ActivityEntry[]> {
  const latestByRole = new Map<string, string>();
  const steps = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    if (entry.type === 'delegation' && entry.phase === 'started') {
      latestByRole.set(entry.role, entry.id);
    } else if ((entry.type === 'thought' && !entry.removed) || entry.type === 'tool') {
      const owner = isCoordinator(entry.role) ? undefined : latestByRole.get(entry.role);
      if (owner) {
        steps.set(owner, [...(steps.get(owner) ?? []), entry]);
      }
    }
  }
  return steps;
}

function toHandoff(started: DelegationEntry, closing: DelegationEntry | undefined, steps: readonly ActivityEntry[]): Handoff {
  const { id, delegationId, round, role, roleName, summary, prompt, projectName, at } = started;
  return {
    id,
    delegationId,
    round,
    role,
    roleName,
    summary,
    prompt,
    ...(projectName ? { projectName } : {}),
    status: closing ? (closing.phase === 'finished' ? 'done' : 'failed') : 'working',
    startedAt: Date.parse(at),
    steps,
    ...(closing?.durationMs !== undefined ? { durationMs: closing.durationMs } : {}),
    ...(closing?.response ? { response: closing.response } : {}),
    ...(closing?.errorMessage ? { errorMessage: closing.errorMessage } : {}),
  };
}

/** The CEO may answer more than once in a turn (a progress note, then the result); only the last completed answer closes the turn. */
function lastAnswerOfEachTurn(entries: readonly ConversationEntry[]): ReadonlySet<string> {
  const answers = new Set<string>();
  let current: string | undefined;
  for (const entry of entries) {
    if (entry.type === 'user_message' && current) {
      answers.add(current);
      current = undefined;
    } else if (entry.type === 'agent_response' && entry.status === 'completed') {
      current = entry.id;
    }
  }
  if (current) {
    answers.add(current);
  }
  return answers;
}

/**
 * Collapses consecutive thought and tool entries of one agent into one activity item (the steps of a delegated agent
 * go inside its handoff), and each delegation (its start and its
 * end) into one handoff; handoffs that start together form a squad. The answer that closes a turn that delegated carries a
 * recap of the team's work. Removed thoughts are dropped.
 */
export function groupEntries(entries: readonly ConversationEntry[]): readonly EntryItem[] {
  const closings = new Map<string, DelegationEntry>();
  for (const entry of entries) {
    if (entry.type === 'delegation' && entry.phase !== 'started') {
      closings.set(entry.delegationId, entry);
    }
  }

  const recapped = lastAnswerOfEachTurn(entries);
  const delegateSteps = stepsByDelegation(entries);
  const delegatedStepIds = new Set([...delegateSteps.values()].flat().map(step => step.id));
  const items: EntryItem[] = [];
  let turnHandoffs: Handoff[] = [];
  let turnStartedAt = 0;
  for (const entry of entries) {
    if (entry.type === 'thought' && entry.removed) {
      continue;
    }
    const last = items.at(-1);
    if (entry.type === 'user_message') {
      turnHandoffs = [];
      turnStartedAt = Date.parse(entry.at);
    }
    if (entry.type === 'thought' || entry.type === 'tool') {
      if (delegatedStepIds.has(entry.id)) {
        continue;
      }
      if (last?.kind === 'activity' && last.steps[0]!.role === entry.role) {
        items[items.length - 1] = { ...last, steps: [...last.steps, entry] };
      } else {
        items.push({ kind: 'activity', id: `activity:${entry.id}`, steps: [entry] });
      }
    } else if (entry.type === 'delegation') {
      if (entry.phase !== 'started') {
        continue;
      }
      const handoff = toHandoff(entry, closings.get(entry.delegationId), delegateSteps.get(entry.id) ?? []);
      turnHandoffs.push(handoff);
      if (last?.kind === 'squad' && last.handoffs[0]!.round === handoff.round) {
        items[items.length - 1] = { ...last, handoffs: [...last.handoffs, handoff] };
      } else {
        items.push({ kind: 'squad', id: `squad:${handoff.id}`, handoffs: [handoff] });
      }
    } else {
      const recap = recapped.has(entry.id) && turnHandoffs.length > 0
        ? { recap: { agents: new Set(turnHandoffs.map(handoff => handoff.role)).size, totalMs: Math.max(0, Date.parse(entry.at) - turnStartedAt) } }
        : {};
      items.push({ kind: 'entry', entry, ...recap });
    }
  }
  return items;
}
