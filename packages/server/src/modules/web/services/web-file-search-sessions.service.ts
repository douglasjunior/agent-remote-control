import { Inject, Injectable } from '@nestjs/common';

import type { WorkspaceFileMatch } from '../../workspace/models/workspace-file-match.model.js';
import { type FileSearchSession, IWorkspaceFileSearchPort } from '../../workspace/ports/workspace-file-search.port.js';
import type { IClientConnection } from '../ports/client-transport.port.js';


type OpenSession = {
  readonly requestId: string;
  readonly session: FileSearchSession;
};

/**
 * One file search per connection. The `requestId` identifies the open list: the first `search` with a
 * new id replaces the previous session and starts a walk, and later ones with the same id only change
 * the query. Every update to the results is sent as a `files.results` event for that id.
 */
@Injectable()
export class WebFileSearchSessionsService {
  private readonly sessions = new Map<string, OpenSession>();

  constructor(@Inject(IWorkspaceFileSearchPort) private readonly fileSearch: IWorkspaceFileSearchPort) {}

  search(connection: IClientConnection, requestId: string, query: string): void {
    const current = this.sessions.get(connection.id);
    if (current?.requestId === requestId) {
      current.session.setQuery(query);
      return;
    }
    current?.session.stop();
    const session = this.open(connection, requestId);
    this.sessions.set(connection.id, { requestId, session });
    session.setQuery(query);
  }

  close(connectionId: string, requestId?: string): void {
    const current = this.sessions.get(connectionId);
    if (!current || (requestId !== undefined && current.requestId !== requestId)) {
      return;
    }
    current.session.stop();
    this.sessions.delete(connectionId);
  }

  private open(connection: IClientConnection, requestId: string): FileSearchSession {
    let items: readonly WorkspaceFileMatch[] = [];
    let walking = false;
    const publish = () => connection.send({ type: 'files.results', requestId, items: items.map(item => ({ ...item, matches: [...item.matches] })), walking });
    return this.fileSearch.start({
      onResults: (matches) => {
        items = matches;
        publish();
      },
      onWalking: (next) => {
        walking = next;
        publish();
      },
    });
  }
}
