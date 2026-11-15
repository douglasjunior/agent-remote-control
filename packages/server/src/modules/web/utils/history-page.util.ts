import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export type HistoryPageOptions = {
  readonly size: number;
  /** Delegations still running, which span every later entry until they end. */
  readonly liveDelegations: ReadonlySet<string>;
};

/**
 * Where the latest page of a history starts: the last segments that fit `size` entries, at least one, and reaching
 * back to the oldest question still open, which the user may answer wherever it sits.
 */
export function latestPageStart(entries: readonly ConversationEntry[], options: HistoryPageOptions): number {
  const openQuestion = entries.findIndex(entry => entry.type === 'question' && !entry.closed);
  return pageStart(entries, entries.length, openQuestion === -1 ? entries.length : openQuestion, options);
}

/** Where the page of the segments right before `before` starts: as many as fit `size` entries, at least one. */
export function earlierPageStart(entries: readonly ConversationEntry[], before: number, options: HistoryPageOptions): number {
  const end = Math.min(before, entries.length);
  return pageStart(entries, end, end, options);
}

function pageStart(entries: readonly ConversationEntry[], end: number, latest: number, { size, liveDelegations }: HistoryPageOptions): number {
  const starts = segmentStarts(entries, liveDelegations).filter(start => start < end);
  const fitting = starts.find(start => end - start <= size) ?? starts.at(-1) ?? 0;
  const reaching = starts.findLast(start => start <= latest) ?? 0;
  return Math.min(fitting, reaching);
}

/**
 * A segment starts at the beginning of the history and at each user message no delegation spans, from its start to
 * its end. A segment therefore holds whole delegations with the steps filed under them, and the latest one holds
 * every delegation the squad still shows. A delegation that never ended and no longer runs, stopped by a restart,
 * spans nothing.
 */
function segmentStarts(entries: readonly ConversationEntry[], liveDelegations: ReadonlySet<string>): number[] {
  const ends = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.type === 'delegation' && entry.phase !== 'started') {
      ends.set(entry.delegationId, index);
    }
  });
  const starts = [0];
  let spannedUntil = 0;
  entries.forEach((entry, index) => {
    if (entry.type === 'user_message' && index > spannedUntil) {
      starts.push(index);
    }
    if (entry.type === 'delegation' && entry.phase === 'started') {
      const end = ends.get(entry.delegationId) ?? (liveDelegations.has(entry.delegationId) ? Infinity : index);
      spannedUntil = Math.max(spannedUntil, end);
    }
  });
  return starts;
}
