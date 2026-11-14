import { takeFragmentParam } from './url-fragment.js';


describe('takeFragmentParam', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('should read one parameter and keep the others in the address bar', () => {
    history.replaceState(null, '', '/i/x?q=1#fp=abc&token=a%2Fb');

    expect(takeFragmentParam('token')).toBe('a/b');
    expect(location.pathname + location.search + location.hash).toBe('/i/x?q=1#fp=abc');
    expect(takeFragmentParam('fp')).toBe('abc');
    expect(location.hash).toBe('');
  });

  it('should leave a fragment without the parameter as it is', () => {
    history.replaceState(null, '', '/#other');

    expect(takeFragmentParam('token')).toBeNull();
    expect(location.hash).toBe('#other');
  });

  it('should strip a malformed value without returning it', () => {
    history.replaceState(null, '', '/#token=%E0%A4%A');

    expect(takeFragmentParam('token')).toBeNull();
    expect(location.hash).toBe('');
  });
});
