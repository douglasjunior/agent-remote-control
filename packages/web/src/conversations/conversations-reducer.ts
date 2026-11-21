import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { ConversationState, ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import type { InterruptedWork, ServerEvent } from '@agent-remote-control/protocol/server-event';
import type { AppliedSquad } from '@agent-remote-control/protocol/squad';


export type ConversationView = {
  /** The entries held, ordered by their position in the history. */
  readonly entryIds: readonly string[];
  readonly entries: Readonly<Record<string, ConversationEntry>>;
  readonly positions: Readonly<Record<string, number>>;
  /** The position the loaded entries start from; the history holds earlier ones while it is above 0. */
  readonly start: number;
  /** The response being written, shown after the entries until the entry that delivers it arrives. */
  readonly draft: string;
  readonly state: ConversationState;
  /**
   * The last entry held when the state was last set. A response after it was published before the state changed, so
   * it ended the turn that the state still reports.
   */
  readonly stateAfter?: string;
  readonly interrupted: readonly InterruptedWork[];
  readonly loaded: boolean;
  readonly configured: boolean;
  readonly profilesLoaded: boolean;
  readonly profiles: readonly RoleProfile[];
  /** The squad the profiles were last copied from. */
  readonly appliedSquad?: AppliedSquad;
  /** Whether a role differs from the applied squad as it is saved now, or the squad was deleted. */
  readonly customized: boolean;
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
  positions: {},
  start: 0,
  draft: '',
  state: 'idle',
  interrupted: [],
  loaded: false,
  configured: false,
  profilesLoaded: false,
  profiles: [],
  customized: false,
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
  const changed = change(view);
  return changed === view ? state : { ...state, byId: { ...state.byId, [conversationId]: changed } };
}

/**
 * Takes a page from `start` as the entries held. Entries already held past the page stay: they were published after
 * the server read the page and reached the client before it.
 */
function withEntries(view: ConversationView, start: number, page: readonly ConversationEntry[]): ConversationView {
  const end = start + page.length;
  const pageIds = new Set(page.map(entry => entry.id));
  const later = view.entryIds.filter(id => view.positions[id] >= end && !pageIds.has(id));
  return {
    ...view,
    start,
    entryIds: [...page.map(entry => entry.id), ...later],
    entries: { ...Object.fromEntries(later.map(id => [id, view.entries[id]])), ...Object.fromEntries(page.map(entry => [entry.id, entry])) },
    positions: { ...Object.fromEntries(later.map(id => [id, view.positions[id]])), ...Object.fromEntries(page.map((entry, index) => [entry.id, start + index])) },
  };
}

/** Puts a page of earlier entries before the ones held, unless it does not end where they start (an answer to a request the history made stale). */
function withEarlierEntries(view: ConversationView, start: number, page: readonly ConversationEntry[]): ConversationView {
  if (!view.loaded || start + page.length !== view.start) {
    return view;
  }
  return {
    ...view,
    start,
    entryIds: [...page.map(entry => entry.id), ...view.entryIds],
    entries: { ...view.entries, ...Object.fromEntries(page.map(entry => [entry.id, entry])) },
    positions: { ...view.positions, ...Object.fromEntries(page.map((entry, index) => [entry.id, start + index])) },
  };
}

/**
 * Upserts an entry published live at its position. An entry before the loaded ones is left out: the page that holds
 * it, read from the history when the reader scrolls back, already carries it as it is now.
 */
function withEntry(view: ConversationView, entry: ConversationEntry, position: number): ConversationView {
  if (view.loaded && position < view.start) {
    return view;
  }
  const known = view.entries[entry.id] !== undefined;
  const after = view.entryIds.findIndex(id => view.positions[id] > position);
  return {
    ...view,
    entryIds: known ? view.entryIds : after === -1 ? [...view.entryIds, entry.id] : view.entryIds.toSpliced(after, 0, entry.id),
    entries: { ...view.entries, [entry.id]: entry },
    positions: { ...view.positions, [entry.id]: position },
  };
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
      return updateView(state, event.conversationId, (view) => {
        const withPage = withEntries(view, event.start, event.entries);
        return {
          ...withPage,
          draft: event.draft ?? '',
          state: event.state,
          stateAfter: withPage.entryIds.at(-1),
          interrupted: event.interrupted ?? [],
          loaded: true,
        };
      });
    case 'conversation.entries':
      return updateView(state, event.conversationId, view => withEarlierEntries(view, event.start, event.entries));
    case 'conversation.entry':
      return updateView(state, event.conversationId, view => withEntry(view, event.entry, event.position));
    case 'conversation.draft':
      return updateView(state, event.conversationId, view => ({ ...view, draft: event.text }));
    case 'conversation.interrupted':
      return updateView(state, event.conversationId, view => ({ ...view, interrupted: event.interrupted }));
    case 'conversation.state':
      return updateView(state, event.conversationId, view => ({ ...view, state: event.state, stateAfter: view.entryIds.at(-1) }));
    case 'agents.list':
      return { ...state, agents: event.agents };
    case 'profiles':
      return updateView(state, event.conversationId, view => ({
        ...view,
        configured: event.configured,
        profiles: event.profiles,
        appliedSquad: event.appliedSquad,
        customized: event.customized,
        profilesLoaded: true,
      }));
    case 'auth.ok':
    case 'auth.failed':
    case 'pong':
    case 'prompts.list':
    case 'files.results':
    case 'upload.ready':
    case 'upload.ack':
    case 'upload.done':
    case 'upload.failed':
    case 'models.list':
    case 'efforts.list':
    case 'quota.report':
    case 'quota.failed':
    case 'auth.status':
    case 'auth.status.failed':
    case 'auth.login':
    case 'projects.list':
    case 'skills.list':
    case 'skill.detail':
    case 'skill.result':
    case 'skill.deleted':
    case 'settings':
    case 'settings.discord.test.result':
    case 'squads':
    case 'artifacts.list':
    case 'artifact.detail':
    case 'artifact.updated':
    case 'artifact.deleted':
    case 'artifact.result':
    case 'error':
      return state;
  }
}
