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
  /** Runs one change at a time, so a transaction never sees another half done; resolves once the change is on disk. */
  transaction<T>(conversationId: string, work: (transaction: ArtifactTransaction) => T): Promise<T>;
}

export const IArtifactStorePort = Symbol('IArtifactStorePort');
