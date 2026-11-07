import { AccessTokenStore } from './access-token-store.js';


describe('AccessTokenStore', () => {
  const tokens = new AccessTokenStore();

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores, reads and clears the token', () => {
    tokens.store('abc');
    expect(tokens.read()).toBe('abc');
    tokens.clear();
    expect(tokens.read()).toBeNull();
  });

  it('replaces the stored token with the fragment token and strips the fragment', () => {
    tokens.store('old');
    history.replaceState(null, '', '/c/1?x=1#token=new%2Ftoken');

    expect(tokens.load()).toBe('new/token');
    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/c/1?x=1');
  });

  it('keeps the stored token when the fragment has no token', () => {
    tokens.store('old');
    history.replaceState(null, '', '/#other');
    expect(tokens.load()).toBe('old');
  });

  it('strips an empty fragment token without storing it', () => {
    history.replaceState(null, '', '/#token=');
    expect(tokens.load()).toBeNull();
    expect(location.hash).toBe('');
  });

  it('returns null without a token', () => {
    expect(tokens.load()).toBeNull();
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

    expect(tokens.read()).toBeNull();
    expect(() => tokens.store('x')).not.toThrow();
    expect(() => tokens.clear()).not.toThrow();
  });
});
