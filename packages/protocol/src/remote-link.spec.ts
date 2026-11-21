import { buildRemoteLink, deriveInstanceId, instanceIdFromPath, isFingerprintOf, trustedSignalingBaseUrl } from './remote-link.js';


const FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('remote-link', () => {
  it('should derive the instance id from the first 10 bytes of the fingerprint', () => {
    expect(deriveInstanceId(FINGERPRINT)).toBe('00010203040506070809');
  });

  it.each([
    ['the fingerprint of its certificate', '00010203040506070809', FINGERPRINT, true],
    ['the fingerprint of another certificate', '00010203040506070809', `B${FINGERPRINT.slice(1)}`, false],
    ['a fingerprint that is not base64url', '00010203040506070809', 'AB:CD', false],
  ])('should tell whether an instance matches %s', (_name, instanceId, fingerprint, expected) => {
    expect(isFingerprintOf(instanceId, fingerprint)).toBe(expected);
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

  it.each([
    ['an HTTPS URL, without its trailing slash', ' https://arc.example.com/ ', 'https://arc.example.com'],
    ['an HTTP URL of localhost', 'http://localhost:3100', 'http://localhost:3100'],
    ['an HTTP URL of 127.0.0.1', 'http://127.0.0.1:3100/', 'http://127.0.0.1:3100'],
    ['an HTTP URL of [::1]', 'http://[::1]:3100', 'http://[::1]:3100'],
    ['an HTTP URL of another host', 'http://arc.example.com', null],
    ['another scheme', 'ftp://arc.example.com', null],
    ['an empty text', '', null],
    ['a text that is no URL', 'arc.example.com', null],
  ])('should trust as a signaling server %s', (_name, text, expected) => {
    expect(trustedSignalingBaseUrl(text)).toBe(expected);
  });
});
