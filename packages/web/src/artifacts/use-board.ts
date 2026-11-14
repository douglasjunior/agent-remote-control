import type { ArtifactCreateInput, ArtifactUpdateInput } from '@agent-remote-control/protocol/artifact';

import { useArtifacts, type MutationResult } from './artifacts-context.js';
import { emptyBoard, type ArtifactBoard } from './artifacts-reducer.js';


export type Board = {
  readonly conversationId: string;
  readonly board: ArtifactBoard;
  readonly projects: readonly string[];
  readonly createArtifact: (artifact: ArtifactCreateInput) => Promise<MutationResult>;
  readonly updateArtifact: (id: string, changes: ArtifactUpdateInput) => Promise<MutationResult>;
  readonly commentArtifact: (id: string, text: string) => Promise<MutationResult>;
  readonly deleteArtifact: (id: string) => Promise<MutationResult>;
};

/** The board of a conversation and the commands bound to it; `ConversationView` asks the server for it. */
export function useBoard(conversationId: string): Board {
  const { state, createArtifact, updateArtifact, commentArtifact, deleteArtifact } = useArtifacts();

  return {
    conversationId,
    board: state.boards[conversationId] ?? emptyBoard,
    projects: state.projects,
    createArtifact: artifact => createArtifact(conversationId, artifact),
    updateArtifact: (id, changes) => updateArtifact(conversationId, id, changes),
    commentArtifact: (id, text) => commentArtifact(conversationId, id, text),
    deleteArtifact: id => deleteArtifact(conversationId, id),
  };
}
