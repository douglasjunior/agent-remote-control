import type {
  Artifact,
  ArtifactActor,
  ArtifactAssignee,
  ArtifactChangeEvent,
  ArtifactChanges,
  ArtifactFilter,
  ArtifactOutcome,
  ArtifactRemoval,
  CreateArtifactInput,
} from '../models/artifact.model.js';


/**
 * The board of features and tasks of each conversation: a conversation is a mission and keeps its own artifacts.
 * Rules about who may change what belong to the caller (the orchestrator checks each agent's access); this port keeps
 * the board consistent: valid tree, one existing project folder per feature and its tasks, known dependencies without cycles, one holder per artifact
 * and a history of every change. Any channel (the web interface, Discord) reads and changes the board through it.
 */
export interface IArtifactsPort {
  list(conversationId: string, filter?: ArtifactFilter): Promise<readonly Artifact[]>;
  get(conversationId: string, id: string): Promise<Artifact | undefined>;
  create(conversationId: string, input: CreateArtifactInput, actor: ArtifactActor): Promise<ArtifactOutcome>;
  update(conversationId: string, id: string, changes: ArtifactChanges, actor: ArtifactActor): Promise<ArtifactOutcome>;
  comment(conversationId: string, id: string, text: string, actor: ArtifactActor): Promise<ArtifactOutcome>;
  /** Refused while the artifact has children or is held by an agent; it leaves the dependencies of the others. */
  remove(conversationId: string, id: string, actor: ArtifactActor): Promise<ArtifactRemoval>;
  /** Refused while another delegation holds the artifact. */
  assign(conversationId: string, id: string, assignee: Omit<ArtifactAssignee, 'since'>): Promise<ArtifactOutcome>;
  /** Frees the artifact when that delegation still holds it; `outcome` tells how the work ended. */
  release(conversationId: string, id: string, delegationId: string, outcome: string): Promise<void>;
  onChange(listener: (event: ArtifactChangeEvent) => void): () => void;
}

export const IArtifactsPort = Symbol('IArtifactsPort');
