import { describe, expect, it } from 'vitest';

import { LoginOutputParser } from './login-output-parser.util.js';


describe('LoginOutputParser', () => {
  it('should report the link a CLI prints without its trailing punctuation', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true.\n')).toEqual([{ kind: 'url', url: 'https://claude.com/cai/oauth/authorize?code=true' }]);
  });

  it('should report a link split across chunks only once it is complete enough to match', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('visit ')).toEqual([]);
    expect(parser.feed('https://cursor.com/loginDeepControl?challenge=1\n')).toEqual([{ kind: 'url', url: 'https://cursor.com/loginDeepControl?challenge=1' }]);
  });

  it('should report the link again when the one-time code arrives after it', () => {
    const parser = new LoginOutputParser();

    const first = parser.feed('1. Open https://auth.openai.com/codex/device\n');
    const second = parser.feed('2. Enter this one-time code\n   57F6-W2U17\n');

    expect(first).toEqual([{ kind: 'url', url: 'https://auth.openai.com/codex/device' }]);
    expect(second).toEqual([{ kind: 'url', url: 'https://auth.openai.com/codex/device', code: '57F6-W2U17' }]);
  });

  it('should read a code that shares the line with the link', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('visit https://github.com/login/device and enter code 731D-4966\n')).toEqual([{ kind: 'url', url: 'https://github.com/login/device', code: '731D-4966' }]);
  });

  it('should not repeat a finding it already reported', () => {
    const parser = new LoginOutputParser();
    parser.feed('https://example.com/login\n');

    expect(parser.feed('Waiting for authorization...\n')).toEqual([]);
  });

  it('should report the prompt that waits for a pasted code even without a newline', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('Paste code here if prompted > ')).toEqual([{ kind: 'prompt', hint: 'Paste code here if prompted >' }]);
    expect(parser.feed('more')).toEqual([]);
  });

  it('should take the prompt line out of multi-line output', () => {
    const parser = new LoginOutputParser();

    const events = parser.feed('Open https://accounts.google.com/o/oauth2/auth?x=1\n\nThen paste the authorization code, or the full URL, and press Enter:\nnext');

    expect(events).toEqual([
      { kind: 'url', url: 'https://accounts.google.com/o/oauth2/auth?x=1' },
      { kind: 'prompt', hint: 'Then paste the authorization code, or the full URL, and press Enter:' },
    ]);
  });

  it('should report a yes or no question the CLI asks, once', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('Waiting...\nSystem keychain unavailable. Store token in plaintext config file? (y/N) ')).toEqual([{ kind: 'question', question: 'System keychain unavailable. Store token in plaintext config file? (y/N)' }]);
    expect(parser.feed('y\n')).toEqual([]);
  });

  it('should reopen the prompt each time the CLI rejects a code, once per rejection', () => {
    const parser = new LoginOutputParser();
    parser.feed('Paste code here if prompted > ');

    expect(parser.feed('Invalid code. Please make sure the full code was copied.\n')).toEqual([{ kind: 'prompt', hint: 'Paste code here if prompted > Invalid code. Please make sure the full code was copied.' }]);
    expect(parser.feed('Paste code here if prompted > ')).toEqual([]);
    expect(parser.feed('Invalid code. Please make sure the full code was copied.\n')).toEqual([{ kind: 'prompt', hint: 'Paste code here if prompted > Invalid code. Please make sure the full code was copied.' }]);
  });

  it('should recognise the rejection wording of the Antigravity login', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('couldn\'t log in: token exchange failed: oauth2: "invalid_grant" "Malformed auth code."\n')).toEqual([{ kind: 'prompt', hint: 'couldn\'t log in: token exchange failed: oauth2: "invalid_grant" "Malformed auth code."' }]);
  });

  it('should ignore terminal escape sequences', () => {
    const parser = new LoginOutputParser();

    expect(parser.feed('\u001B[1mhttps://example.com/a\u001B[22m\n')).toEqual([{ kind: 'url', url: 'https://example.com/a' }]);
  });

  describe('lastMessage', () => {
    it('should return the last line that is not a link or a code', () => {
      const parser = new LoginOutputParser();
      parser.feed('open https://example.com/x\nENTER-CODE 1234-5678\nInvalid code. Copy the full code.\n  \n');

      expect(parser.lastMessage()).toBe('Invalid code. Copy the full code.');
    });

    it('should prefer the line that reads like a failure over a trailing stack-trace line', () => {
      const parser = new LoginOutputParser();
      parser.feed('Error: Missing optional dependency @openai/codex-linux-x64\n    at findCodexExecutable (codex.js:108:9)\n\nNode.js v22.23.2\n');

      expect(parser.lastMessage()).toBe('Error: Missing optional dependency @openai/codex-linux-x64');
    });

    it('should be undefined when nothing meaningful was printed', () => {
      expect(new LoginOutputParser().lastMessage()).toBeUndefined();
    });
  });
});
