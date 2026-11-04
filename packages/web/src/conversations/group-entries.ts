import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export type ActivityEntry = Extract<ConversationEntry, { type: 'thought' | 'tool' }>;

export type EntryItem =
  | { readonly kind: 'entry'; readonly entry: Exclude<ConversationEntry, ActivityEntry> }
  | { readonly kind: 'activity'; readonly id: string; readonly steps: readonly ActivityEntry[] };

/** Collapses consecutive thought and tool entries into one activity item; removed thoughts are dropped. */
export function groupEntries(entries: readonly ConversationEntry[]): readonly EntryItem[] {
  const items: EntryItem[] = [];
  for (const entry of entries) {
    if (entry.type === 'thought' && entry.removed) {
      continue;
    }
    if (entry.type === 'thought' || entry.type === 'tool') {
      const last = items[items.length - 1];
      if (last?.kind === 'activity') {
        items[items.length - 1] = { ...last, steps: [...last.steps, entry] };
      } else {
        items.push({ kind: 'activity', id: `activity:${entry.id}`, steps: [entry] });
      }
      continue;
    }
    items.push({ kind: 'entry', entry });
  }
  return items;
}
