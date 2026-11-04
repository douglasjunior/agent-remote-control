import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { ConversationState, ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';


export type ConversationView = {
  readonly entryIds: readonly string[];
  readonly entries: Readonly<Record<string, ConversationEntry>>;
  /** The response being written, shown after the entries until the entry that delivers it arrives. */
  readonly draft: string;
  readonly state: ConversationState;
  readonly loaded: boolean;
  readonly configured: boolean;
  readonly profilesLoaded: boolean;
  readonly profiles: readonly RoleProfile[];
};

export type ConversationsState = {
  readonly list: readonly ConversationSummary[];
  readonly agents: readonly AgentOption[];
  readonly byId: Readonly<Record<string, ConversationView>>;
};

export const initialConversationsState: ConversationsState = {
  list: [],
  agents: [],
  byId: {},
};

export const emptyConversationView: ConversationView = {
  entryIds: [],
  entries: {},
  draft: '',
  state: 'idle',
  loaded: false,
  configured: false,
  profilesLoaded: false,
  profiles: [],
};

function sortByUpdatedAt(list: readonly ConversationSummary[]): readonly ConversationSummary[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertSummary(
  list: readonly ConversationSummary[],
  summary: ConversationSummary,
): readonly ConversationSummary[] {
  return sortByUpdatedAt([...list.filter(item => item.id !== summary.id), summary]);
}

function updateView(
  state: ConversationsState,
  conversationId: string,
  change: (view: ConversationView) => ConversationView,
): ConversationsState {
  const view = state.byId[conversationId] ?? emptyConversationView;
  return { ...state, byId: { ...state.byId, [conversationId]: change(view) } };
}

export function conversationsReducer(state: ConversationsState, event: ServerEvent): ConversationsState {
  switch (event.type) {
    case 'conversation.list':
      return { ...state, list: sortByUpdatedAt(event.conversations) };
    case 'conversation.created':
      return { ...state, list: upsertSummary(state.list, event.conversation) };
    case 'conversation.updated':
      return { ...state, list: upsertSummary(state.list, event.conversation) };
    case 'conversation.history':
      return updateView(state, event.conversationId, view => ({
        ...view,
        entryIds: event.entries.map(entry => entry.id),
        entries: Object.fromEntries(event.entries.map(entry => [entry.id, entry])),
        draft: event.draft ?? '',
        state: event.state,
        loaded: true,
      }));
    case 'conversation.entry':
      return updateView(state, event.conversationId, view => ({
        ...view,
        entryIds: view.entries[event.entry.id] ? view.entryIds : [...view.entryIds, event.entry.id],
        entries: { ...view.entries, [event.entry.id]: event.entry },
      }));
    case 'conversation.draft':
      return updateView(state, event.conversationId, view => ({ ...view, draft: event.text }));
    case 'conversation.state':
      return updateView(state, event.conversationId, view => ({ ...view, state: event.state }));
    case 'agents.list':
      return { ...state, agents: event.agents };
    case 'profiles':
      return updateView(state, event.conversationId, view => ({
        ...view,
        configured: event.configured,
        profiles: event.profiles,
        profilesLoaded: true,
      }));
    case 'auth.ok':
    case 'auth.failed':
    case 'prompts.list':
    case 'files.results':
    case 'upload.ready':
    case 'upload.ack':
    case 'upload.done':
    case 'upload.failed':
    case 'models.list':
    case 'efforts.list':
    case 'error':
      return state;
  }
}
