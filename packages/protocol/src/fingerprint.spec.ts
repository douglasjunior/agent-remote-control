import { encodeFingerprint, sdpFingerprint } from './fingerprint.js';


const HEX = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0').toUpperCase()).join(':');
const ENCODED = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('fingerprint', () => {
  it('should encode a hex fingerprint as base64url', () => {
    expect(encodeFingerprint(HEX)).toBe(ENCODED);
    expect(encodeFingerprint(Array.from({ length: 32 }, () => 'FB').join(':'))).toMatch(/^[\w-]+$/);
  });

  it('should read the sha-256 fingerprint of an SDP in any case', () => {
    expect(sdpFingerprint(`v=0\r\na=fingerprint:sha-256 ${HEX.toLowerCase()}\r\na=setup:active\r\n`)).toBe(ENCODED);
  });

  it('should accept the same fingerprint repeated in every media section', () => {
    expect(sdpFingerprint(`a=fingerprint:sha-256 ${HEX}\nm=application\na=fingerprint:sha-256 ${HEX}\n`)).toBe(ENCODED);
  });

  it.each([
    ['no fingerprint', 'v=0\r\n'],
    ['only another algorithm', `a=fingerprint:sha-1 ${HEX}\r\n`],
    ['two different fingerprints', `a=fingerprint:sha-256 ${HEX}\na=fingerprint:sha-256 ${HEX.replace('00', 'FF')}\n`],
  ])('should give no fingerprint for an SDP with %s', (_name, sdp) => {
    expect(sdpFingerprint(sdp)).toBeNull();
  });
});
