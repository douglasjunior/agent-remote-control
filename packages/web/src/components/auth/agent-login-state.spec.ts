import { safeLoginUrl } from './agent-login-state.js';


describe('safeLoginUrl', () => {
  it('accepts a web link', () => {
    expect(safeLoginUrl('https://claude.com/oauth')).toBe('https://claude.com/oauth');
  });

  it.each(['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', undefined])(
    'rejects %s',
    (url) => {
      expect(safeLoginUrl(url)).toBeUndefined();
    },
  );
});
