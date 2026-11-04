import { FakeClientConnection } from '../testing/fake-client-connection.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


describe('WebConnectionRegistryService', () => {
  it('broadcasts to registered connections and forgets closed ones', () => {
    const registry = new WebConnectionRegistryService();
    const first = new FakeClientConnection('a');
    const second = new FakeClientConnection('b');
    registry.register(first);
    registry.register(second);

    registry.broadcast({ type: 'auth.ok' });
    first.simulateClose();
    registry.broadcast({ type: 'auth.failed' });

    expect(first.sent).toEqual([{ type: 'auth.ok' }]);
    expect(second.sent).toEqual([{ type: 'auth.ok' }, { type: 'auth.failed' }]);
    expect(registry.size).toBe(1);
  });
});
