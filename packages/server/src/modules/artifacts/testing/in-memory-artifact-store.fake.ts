import { ARTIFACT_ID_PREFIXES } from '../constants/artifact-catalog.constant.js';
import type { Artifact } from '../models/artifact.model.js';
import type { ArtifactTransaction, IArtifactStorePort } from '../ports/artifact-store.port.js';


type Board = { readonly artifacts: Map<string, Artifact>; readonly counters: Record<string, number> };

export class InMemoryArtifactStoreFake implements IArtifactStorePort {
  readonly boards = new Map<string, Board>();
  transactions = 0;

  /** `initial` fills the board of `conversationId`. */
  constructor(initial: readonly Artifact[] = [], conversationId = 'c1') {
    if (initial.length > 0) {
      this.board(conversationId);
      initial.forEach(artifact => this.board(conversationId).artifacts.set(artifact.id, artifact));
    }
  }

  /** The artifacts of a conversation, read straight from the fake. */
  artifactsOf(conversationId = 'c1'): Map<string, Artifact> {
    return this.board(conversationId).artifacts;
  }

  async conversations(): Promise<readonly string[]> {
    return [...this.boards.keys()];
  }

  async list(conversationId: string): Promise<readonly Artifact[]> {
    return [...this.board(conversationId).artifacts.values()];
  }

  async find(conversationId: string, id: string): Promise<Artifact | undefined> {
    return this.board(conversationId).artifacts.get(id);
  }

  async transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T> {
    this.transactions++;
    const board = this.board(conversationId);
    const staged = new Map(board.artifacts);
    const counters = { ...board.counters };
    const result = work({
      find: id => staged.get(id),
      list: () => [...staged.values()],
      allocateId: (type) => {
        const prefix = ARTIFACT_ID_PREFIXES[type];
        do {
          counters[prefix] = (counters[prefix] ?? 0) + 1;
        } while (staged.has(`${prefix}-${counters[prefix]}`));
        return `${prefix}-${counters[prefix]}`;
      },
      save: (artifact) => {
        staged.set(artifact.id, artifact);
      },
      remove: (id) => {
        staged.delete(id);
      },
    });
    board.artifacts.clear();
    staged.forEach((artifact, id) => board.artifacts.set(id, artifact));
    Object.assign(board.counters, counters);
    return result;
  }

  private board(conversationId: string): Board {
    let board = this.boards.get(conversationId);
    if (!board) {
      board = { artifacts: new Map(), counters: {} };
      this.boards.set(conversationId, board);
    }
    return board;
  }
}
