import { buildRemoteLink, deriveInstanceId, instanceIdFromPath } from './remote-link.js';


describe('remote-link', () => {
  it('should derive a stable 20 hex characters instance id from the secret', async () => {
    const id = await deriveInstanceId('secret');

    expect(id).toBe('2bb80d537b1da3e38bd3');
    expect(await deriveInstanceId('secret')).toBe(id);
    expect(await deriveInstanceId('other')).not.toBe(id);
  });

  it('should put the fingerprint and the token in the fragment of the link', () => {
    expect(buildRemoteLink('https://arc.example.com/', '0123456789abcdef0123', 'fp-1', 'to/ken+'))
      .toBe('https://arc.example.com/i/0123456789abcdef0123#fp=fp-1&token=to%2Fken%2B');
  });

  it.each([
    ['/i/0123456789abcdef0123', '0123456789abcdef0123'],
    ['/i/0123456789abcdef0123/c/web-1', '0123456789abcdef0123'],
    ['/', null],
    ['/i/short', null],
    ['/i/0123456789abcdef01234', null],
  ])('should read the instance id of %s', (path, expected) => {
    expect(instanceIdFromPath(path)).toBe(expected);
  });
});
