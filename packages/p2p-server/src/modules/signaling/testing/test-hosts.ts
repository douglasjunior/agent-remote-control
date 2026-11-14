import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload } from '@agent-remote-control/protocol/signaling';
import { sign, X509Certificate } from 'node:crypto';


/** Self-signed P-256 certificates made for these tests only. */
const IDENTITIES = [
  {
    certificate: `-----BEGIN CERTIFICATE-----
MIIBFzCBvgIJAJQoTAjer4puMAoGCCqGSM49BAMCMBMxETAPBgNVBAMMCGFyYy10
ZXN0MCAXDTI2MTExNDIxNTQyOFoYDzIxMjYxMDIxMjE1NDI4WjATMREwDwYDVQQD
DAhhcmMtdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABI2ln4mf3rAwpgrG
ZSJ8wAYZj1gGCuq2fVKYf6Vhfh6k43Vx4AFB7USYggb6V2EWB2GDJQ4ouzj5eQiA
A++1J8swCgYIKoZIzj0EAwIDSAAwRQIhAKGb9+wdnpzAbICN6SiBadTtL7miocjC
5KQT9KVs7W1aAiB34H8A+t5jSkMkh3CFqj4So7V4zWZWnFcDoSeyPcB4tQ==
-----END CERTIFICATE-----`,
    key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg6uJy+Cde6Qgsfnnp
x0W0R3Xp9i/4OyyNPN4FP7GiWyehRANCAASNpZ+Jn96wMKYKxmUifMAGGY9YBgrq
tn1SmH+lYX4epON1ceABQe1EmIIG+ldhFgdhgyUOKLs4+XkIgAPvtSfL
-----END PRIVATE KEY-----`,
  },
  {
    certificate: `-----BEGIN CERTIFICATE-----
MIIBGDCBvgIJAKMIVofUDTvgMAoGCCqGSM49BAMCMBMxETAPBgNVBAMMCGFyYy10
ZXN0MCAXDTI2MTExNDIxNTQyOFoYDzIxMjYxMDIxMjE1NDI4WjATMREwDwYDVQQD
DAhhcmMtdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABICrPp4tos0HCTI6
3Ml25wcNKTfWNVSD7iNeLRWzpkMdBZKrQdl3oip6ZIzmkrbcCMRnImegY5h2tuTs
9bTvq1gwCgYIKoZIzj0EAwIDSQAwRgIhAPEzmPINpd9HUKIwOGEU8BGB78Dy6Zfj
JyzgABYCppxVAiEAggBA0emuOuyVBmJtRWsdo4HLkWQEwysKUIH9c36wwb0=
-----END CERTIFICATE-----`,
    key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSIiVZxOhr79gwchV
nDTgU/Dwpox2nvRBLoqO3dS0+Z+hRANCAASAqz6eLaLNBwkyOtzJducHDSk31jVU
g+4jXi0Vs6ZDHQWSq0HZd6IqemSM5pK23AjEZyJnoGOYdrbk7PW076tY
-----END PRIVATE KEY-----`,
  },
];

export type TestHost = {
  readonly instanceId: string;
  /** The `host.register` a host holding this identity sends for the nonce of its challenge. */
  register(nonce: string, protocolVersion?: number): {
    type: 'host.register';
    instanceId: string;
    certificate: string;
    signature: string;
    protocolVersion: number;
  };
};

export const TEST_HOSTS: readonly TestHost[] = IDENTITIES.map(({ certificate, key }) => {
  const x509 = new X509Certificate(certificate);
  const instanceId = deriveInstanceId(encodeFingerprint(x509.fingerprint256));
  return {
    instanceId,
    register: (nonce, protocolVersion = 3) => ({
      type: 'host.register',
      instanceId,
      certificate: x509.raw.toString('base64'),
      signature: sign('sha256', Buffer.from(registrationPayload(nonce)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
      protocolVersion,
    }),
  };
});
