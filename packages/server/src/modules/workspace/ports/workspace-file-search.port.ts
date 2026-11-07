import type { WorkspaceFileMatch } from '../models/workspace-file-match.model.js';


export type FileSearchListener = {
  /** Replaces the previous results; called again as the walk finds more entries or the query changes. */
  onResults(matches: readonly WorkspaceFileMatch[]): void;
  /** `true` while the walk still delivers entries. */
  onWalking(walking: boolean): void;
};

export interface FileSearchSession {
  setQuery(query: string): void;
  /** Cancels the walk; nothing is published afterwards. */
  stop(): void;
}

export interface IWorkspaceFileSearchPort {
  /**
   * Opens a search over the workspace base directory. Every session walks the disk again, so files
   * created between two sessions show up without an index to invalidate.
   */
  start(listener: FileSearchListener): FileSearchSession;
}

export const IWorkspaceFileSearchPort = Symbol('IWorkspaceFileSearchPort');
