import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { FakeWorkspaceFileSearch } from '../testing/fake-workspace-file-search.js';

import { WebFileSearchSessionsService } from './web-file-search-sessions.service.js';


const match = { path: 'app/', kind: 'directory' as const, matches: [0, 1] };

function setup() {
  const fileSearch = new FakeWorkspaceFileSearch();
  const service = new WebFileSearchSessionsService(fileSearch);
  const connection = new FakeClientConnection('c1');
  return { fileSearch, service, connection };
}

describe('WebFileSearchSessionsService', () => {
  it('starts a session on the first search, announcing the walk', () => {
    const { service, connection, fileSearch } = setup();

    service.search(connection, 'r1', 'ap');

    expect(fileSearch.sessions[0].queries).toEqual(['ap']);
    expect(connection.sent).toEqual([{ type: 'files.results', requestId: 'r1', items: [], walking: true }]);
  });

  it('sends the results and the end of the walk under the request id', () => {
    const { service, connection, fileSearch } = setup();
    service.search(connection, 'r1', '');

    fileSearch.sessions[0].emit([match]);
    fileSearch.sessions[0].finishWalking();

    expect(connection.sent.slice(1)).toEqual([
      { type: 'files.results', requestId: 'r1', items: [match], walking: true },
      { type: 'files.results', requestId: 'r1', items: [match], walking: false },
    ]);
  });

  it('only changes the query while the request id stays the same', () => {
    const { service, connection, fileSearch } = setup();

    service.search(connection, 'r1', 'a');
    service.search(connection, 'r1', 'ab');

    expect(fileSearch.sessions).toHaveLength(1);
    expect(fileSearch.sessions[0].queries).toEqual(['a', 'ab']);
  });

  it('replaces the session when the request id changes', () => {
    const { service, connection, fileSearch } = setup();

    service.search(connection, 'r1', 'a');
    service.search(connection, 'r2', 'b');

    expect(fileSearch.sessions.map(session => session.stopped)).toEqual([true, false]);
    expect(fileSearch.sessions[1].queries).toEqual(['b']);
  });

  it('keeps one session per connection', () => {
    const { service, connection, fileSearch } = setup();

    service.search(connection, 'r1', '');
    service.search(new FakeClientConnection('c2'), 'r1', '');

    expect(fileSearch.sessions.map(session => session.stopped)).toEqual([false, false]);
  });

  it('closes the session of the matching request id only', () => {
    const { service, connection, fileSearch } = setup();
    service.search(connection, 'r1', '');

    service.close('c1', 'other');
    expect(fileSearch.sessions[0].stopped).toBe(false);

    service.close('c1', 'r1');
    expect(fileSearch.sessions[0].stopped).toBe(true);
  });

  it('closes whatever session the connection has when no request id is given, and ignores unknown connections', () => {
    const { service, connection, fileSearch } = setup();
    service.search(connection, 'r1', '');

    service.close('unknown');
    service.close('c1');

    expect(fileSearch.sessions[0].stopped).toBe(true);
  });
});
