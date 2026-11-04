import { clearAccessToken, loadAccessToken, readAccessToken, storeAccessToken } from './access-token.js';


describe('access token', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores, reads and clears the token', () => {
    storeAccessToken('abc');
    expect(readAccessToken()).toBe('abc');
    clearAccessToken();
    expect(readAccessToken()).toBeNull();
  });

  it('replaces the stored token with the fragment token and strips the fragment', () => {
    storeAccessToken('old');
    history.replaceState(null, '', '/c/1?x=1#token=new%2Ftoken');

    expect(loadAccessToken()).toBe('new/token');
    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/c/1?x=1');
  });

  it('keeps the stored token when the fragment has no token', () => {
    storeAccessToken('old');
    history.replaceState(null, '', '/#other');
    expect(loadAccessToken()).toBe('old');
  });

  it('strips an empty fragment token without storing it', () => {
    history.replaceState(null, '', '/#token=');
    expect(loadAccessToken()).toBeNull();
    expect(location.hash).toBe('');
  });

  it('returns null without a token', () => {
    expect(loadAccessToken()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readAccessToken()).toBeNull();
    expect(() => storeAccessToken('x')).not.toThrow();
    expect(() => clearAccessToken()).not.toThrow();
  });
});
