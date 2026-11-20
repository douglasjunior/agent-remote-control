import type { Artifact, ArtifactType } from '../models/artifact.model.js';


/** The artifacts of one conversation as one transaction sees them; what it saves or removes is kept only if the whole work succeeds. */
export interface ArtifactTransaction {
  find(id: string): Artifact | undefined;
  list(): readonly Artifact[];
  /** The next free id of the type in the conversation, such as `T-12`; ids are never reused. */
  allocateId(type: ArtifactType): string;
  save(artifact: Artifact): void;
  remove(id: string): void;
}

/** Each conversation keeps its own artifacts, so ids repeat across conversations. */
export interface IArtifactStorePort {
  /** The conversations that have artifacts. */
  conversations(): Promise<readonly string[]>;
  list(conversationId: string): Promise<readonly Artifact[]>;
  find(conversationId: string, id: string): Promise<Artifact | undefined>;
  /**
   * Runs `work` on the board as it is on disk, one transaction at a time across processes, so none sees another half
   * done; resolves once its changes are on disk. A transaction that changes nothing writes nothing.
   */
  transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T>;
}

export const IArtifactStorePort = Symbol('IArtifactStorePort');
