import { createHmac } from 'node:crypto';

import { sessionProof, sessionProofMessage } from './session-proof.js';


const FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('sessionProof', () => {
  it('should give a base64url HMAC-SHA256 that depends on the token, the instance and the fingerprint', async () => {
    const proof = await sessionProof('token', '00010203040506070809', FINGERPRINT);

    expect(proof).toBe(createHmac('sha256', 'token').update(sessionProofMessage('00010203040506070809', FINGERPRINT)).digest('base64url'));
    expect(await sessionProof('token', '00010203040506070809', FINGERPRINT)).toBe(proof);
    expect(await sessionProof('other', '00010203040506070809', FINGERPRINT)).not.toBe(proof);
    expect(await sessionProof('token', '0001020304050607080a', FINGERPRINT)).not.toBe(proof);
    expect(await sessionProof('token', '00010203040506070809', `B${FINGERPRINT.slice(1)}`)).not.toBe(proof);
  });
});
