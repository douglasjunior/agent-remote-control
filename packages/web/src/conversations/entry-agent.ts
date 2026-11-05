import type { EntryItem } from './group-entries.js';


/**
 * The role a feed item belongs to, which decides whether a focus on another agent dims it. User messages, notices and
 * squads (whose handoffs each carry a role of their own) belong to nobody.
 */
export function entryAgent(item: EntryItem): string | undefined {
  switch (item.kind) {
    case 'activity': return item.steps[0]!.role;
    case 'squad': return undefined;
    case 'entry':
      switch (item.entry.type) {
        case 'agent_response':
        case 'interim': return 'CEO';
        case 'question': return item.entry.askerRole;
        default: return undefined;
      }
  }
}
