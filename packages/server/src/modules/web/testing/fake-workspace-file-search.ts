import type { WorkspaceFileMatch } from '../../workspace/models/workspace-file-match.model.js';
import type { FileSearchListener, FileSearchSession, IWorkspaceFileSearchPort } from '../../workspace/ports/workspace-file-search.port.js';


export class FakeFileSearchSession implements FileSearchSession {
  readonly queries: string[] = [];
  stopped = false;

  constructor(readonly listener: FileSearchListener) {}

  setQuery(query: string): void {
    this.queries.push(query);
  }

  stop(): void {
    this.stopped = true;
  }

  /** Publishes as the real session does, unless it was stopped. */
  emit(matches: readonly WorkspaceFileMatch[]): void {
    this.listener.onResults(matches);
  }

  finishWalking(): void {
    this.listener.onWalking(false);
  }
}

export class FakeWorkspaceFileSearch implements IWorkspaceFileSearchPort {
  readonly sessions: FakeFileSearchSession[] = [];

  start(listener: FileSearchListener): FileSearchSession {
    const session = new FakeFileSearchSession(listener);
    listener.onWalking(true);
    this.sessions.push(session);
    return session;
  }
}
