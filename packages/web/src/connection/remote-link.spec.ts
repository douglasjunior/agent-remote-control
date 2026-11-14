import { readRemoteLink } from './remote-link.js';


const FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const INSTANCE = '00010203040506070809';
const FOREIGN = `B${FINGERPRINT.slice(1)}`;

describe('readRemoteLink', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, '', '/');
  });

  it('should read the instance from the path and keep the fingerprint of the link', () => {
    history.replaceState(null, '', `/i/${INSTANCE}/c/web-1#fp=${FINGERPRINT}&token=t`);

    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: FINGERPRINT });
    expect(location.hash).toBe('#token=t');
    history.replaceState(null, '', `/i/${INSTANCE}`);
    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: FINGERPRINT });
  });

  it('should have no link outside an instance path or without a fingerprint', () => {
    history.replaceState(null, '', `/#fp=${FINGERPRINT}`);
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
    history.replaceState(null, '', `/i/${INSTANCE}#fp=${FINGERPRINT}`);

    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: FINGERPRINT });
    history.replaceState(null, '', `/i/${INSTANCE}`);
    expect(readRemoteLink()).toBeNull();
  });

  it('should ignore a fingerprint of another certificate than the instance\'s, from the link or from storage', () => {
    history.replaceState(null, '', `/i/${INSTANCE}#fp=${FINGERPRINT}`);
    readRemoteLink();
    history.replaceState(null, '', `/i/${INSTANCE}#fp=${FOREIGN}`);

    expect(readRemoteLink()).toEqual({ instanceId: INSTANCE, fingerprint: FINGERPRINT });
    localStorage.setItem(`arc.remote.${INSTANCE}.fingerprint`, FOREIGN);
    expect(readRemoteLink()).toBeNull();
  });
});
