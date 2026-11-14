import type { IClientConnection } from '../ports/client-transport.port.js';
import { FakeClientConnection, FakeClientTransport } from '../testing/fake-client-connection.js';

import { CombinedClientTransportAdapter } from './combined-client-transport.adapter.js';


describe('CombinedClientTransportAdapter', () => {
  it('should hand the connections of every transport until unsubscribed', () => {
    const local = new FakeClientTransport();
    const remote = new FakeClientTransport();
    const received: IClientConnection[] = [];
    const unsubscribe = new CombinedClientTransportAdapter([local, remote]).onConnection(connection => received.push(connection));
    const first = new FakeClientConnection('a');
    const second = new FakeClientConnection('b');

    local.connect(first);
    remote.connect(second);
    unsubscribe();
    local.connect(new FakeClientConnection());

    expect(received).toEqual([first, second]);
  });
});
