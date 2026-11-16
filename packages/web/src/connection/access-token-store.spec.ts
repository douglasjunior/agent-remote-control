import { AccessTokenStore } from './access-token-store.js';


describe('AccessTokenStore', () => {
  const tokens = new AccessTokenStore();

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should store, read and clear the token', () => {
    tokens.store('abc');
    expect(tokens.read()).toBe('abc');
    tokens.clear();
    expect(tokens.read()).toBeNull();
  });

  it('should replace the stored token with the fragment token and strip the fragment', () => {
    tokens.store('old');
    history.replaceState(null, '', '/c/1?x=1#token=new%2Ftoken');

    expect(tokens.load()).toBe('new/token');
    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/c/1?x=1');
  });

  it('should keep the stored token when the fragment has no token', () => {
    tokens.store('old');
    history.replaceState(null, '', '/#other');
    expect(tokens.load()).toBe('old');
  });

  it('should strip an empty fragment token without storing it', () => {
    history.replaceState(null, '', '/#token=');
    expect(tokens.load()).toBeNull();
    expect(location.hash).toBe('');
  });

  it('should keep the token of each storage key apart', () => {
    const remote = new AccessTokenStore('arc.accessToken.instance');
    tokens.store('local');
    remote.store('remote');

    expect(tokens.read()).toBe('local');
    expect(remote.read()).toBe('remote');
  });

  it('should take the token of a remote link and leave its fingerprint', () => {
    history.replaceState(null, '', '/i/x#fp=abc&token=t');

    expect(tokens.load()).toBe('t');
    expect(location.hash).toBe('#fp=abc');
  });

  it('should return null without a token', () => {
    expect(tokens.load()).toBeNull();
  });

  it('should survive storage that throws', () => {
    rs.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    rs.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    rs.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(tokens.read()).toBeNull();
    expect(() => tokens.store('x')).not.toThrow();
    expect(() => tokens.clear()).not.toThrow();
  });
});
