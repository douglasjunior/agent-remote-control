import { describe, expect, it } from '@rstest/core';

import { ISessionStorePort } from './session-store.port.js';


describe('session-store.port', () => {
  it('should define ISessionStorePort symbol for dependency injection', () => {
    expect(typeof ISessionStorePort).toBe('symbol');
    expect(ISessionStorePort.description).toBe('ISessionStorePort');
  });
});
