import type { ArtifactDetail, ArtifactSummary } from '@agent-remote-control/protocol/artifact';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';


/** The artifacts of one conversation: each conversation keeps the board of its own mission. */
export type ArtifactBoard = {
  /** Whether the first `artifacts.list` of the conversation arrived. */
  readonly loaded: boolean;
  readonly byId: Readonly<Record<string, ArtifactSummary>>;
  readonly details: Readonly<Record<string, ArtifactDetail>>;
};

export type ArtifactsState = {
  readonly boards: Readonly<Record<string, ArtifactBoard>>;
  /** The project folders of the workspace, shared by every conversation. */
  readonly projects: readonly string[];
};

export const emptyBoard: ArtifactBoard = { loaded: false, byId: {}, details: {} };

export const initialArtifactsState: ArtifactsState = { boards: {}, projects: [] };

function without<T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const { [id]: _removed, ...rest } = record;
  return rest;
}

function updateBoard(state: ArtifactsState, conversationId: string, change: (board: ArtifactBoard) => ArtifactBoard): ArtifactsState {
  return { ...state, boards: { ...state.boards, [conversationId]: change(state.boards[conversationId] ?? emptyBoard) } };
}

/** Keeps the summaries every view reads and the details opened so far, per conversation; other events pass through. */
export function artifactsReducer(state: ArtifactsState, event: ServerEvent): ArtifactsState {
  switch (event.type) {
    case 'projects.list':
      return { ...state, projects: event.projects };
    case 'artifacts.list':
      return updateBoard(state, event.conversationId, board => ({
        ...board,
        loaded: true,
        byId: Object.fromEntries(event.artifacts.map(artifact => [artifact.id, artifact])),
      }));
    case 'artifact.updated':
      return updateBoard(state, event.conversationId, (board) => {
        const { artifact } = event;
        const detail = board.details[artifact.id];
        return {
          ...board,
          byId: { ...board.byId, [artifact.id]: artifact },
          details: detail ? { ...board.details, [artifact.id]: { ...detail, ...artifact } } : board.details,
        };
      });
    case 'artifact.detail':
      return updateBoard(state, event.conversationId, (board) => {
        const { sections: _sections, history: _history, ...summary } = event.artifact;
        return {
          ...board,
          byId: { ...board.byId, [summary.id]: summary },
          details: { ...board.details, [summary.id]: event.artifact },
        };
      });
    case 'artifact.deleted':
      return updateBoard(state, event.conversationId, board => ({
        ...board,
        byId: without(board.byId, event.id),
        details: without(board.details, event.id),
      }));
    default:
      return state;
  }
}
