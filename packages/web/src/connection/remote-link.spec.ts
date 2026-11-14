import { readRemoteLink } from './remote-link.js';


const INSTANCE = '0123456789abcdef0123';

describe('readRemoteLink', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, '', '/');
  });

  it('should read the instance from the path and keep the fingerprint of the link', () => {
    history.replaceState(null, '', `/i/${INSTANCE}/c/web-1#fp=pinned&token=t`);

    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: 'pinned' });
    expect(location.hash).toBe('#token=t');
    history.replaceState(null, '', `/i/${INSTANCE}`);
    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: 'pinned' });
  });

  it('should have no link outside an instance path or without a fingerprint', () => {
    history.replaceState(null, '', '/#fp=pinned');
    expect(readRemoteLink()).toBeNull();

    history.replaceState(null, '', `/i/${INSTANCE}`);
    expect(readRemoteLink()).toBeNull();
  });

  it('should use the fingerprint of the link when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    history.replaceState(null, '', `/i/${INSTANCE}#fp=pinned`);

    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: 'pinned' });
    history.replaceState(null, '', `/i/${INSTANCE}`);
    expect(readRemoteLink()).toBeNull();
  });
});
