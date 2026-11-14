import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload } from '@agent-remote-control/protocol/signaling';
import { verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { RemoteIdentityService } from './remote-identity.service.js';


describe('RemoteIdentityService', () => {
  let dataDir: string;
  const service = () => new RemoteIdentityService(dataDirectoryAt(dataDir));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'remote-identity-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should be enabled only when REMOTE_ENABLED is true', () => {
    expect(service().isEnabled()).toBe(false);
    vi.stubEnv('REMOTE_ENABLED', 'yes');
    expect(service().isEnabled()).toBe(false);
    vi.stubEnv('REMOTE_ENABLED', 'true');
    expect(service().isEnabled()).toBe(true);
  });

  it.each([
    ['https://arc.example.com/', 'https://arc.example.com', 'wss://arc.example.com/signal/host'],
    [' http://localhost:3100/ ', 'http://localhost:3100', 'ws://localhost:3100/signal/host'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173', 'ws://127.0.0.1:5173/signal/host'],
    ['http://[::1]:3100', 'http://[::1]:3100', 'ws://[::1]:3100/signal/host'],
  ])('should reach REMOTE_URL %s over the matching WebSocket scheme', (remoteUrl, baseUrl, signalingUrl) => {
    vi.stubEnv('REMOTE_URL', remoteUrl);

    expect(service().baseUrl()).toBe(baseUrl);
    expect(service().signalingUrl(baseUrl)).toBe(signalingUrl);
  });

  it.each([
    ['missing', undefined],
    ['blank', '  '],
    ['not a URL', 'arc.example.com'],
    ['plain HTTP to another machine', 'http://arc.example.com'],
    ['of another scheme', 'ftp://arc.example.com'],
  ])('should have no signaling server when REMOTE_URL is %s', (_name, remoteUrl) => {
    vi.stubEnv('REMOTE_URL', remoteUrl);

    expect(service().baseUrl()).toBeNull();
  });

  it('should create the certificate and its key once, readable by the owner only', async () => {
    const created = await service().identity();
    const reloaded = await service().identity();
    const directory = join(dataDir, 'remote');

    expect(reloaded).toEqual(created);
    expect(created).toMatchObject({
      certificatePath: join(directory, 'certificate.pem'),
      keyPath: join(directory, 'key.pem'),
    });
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    for (const file of ['certificate.pem', 'key.pem']) {
      expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
    }
    const x509 = new X509Certificate(readFileSync(created.certificatePath));
    expect(created.fingerprint).toBe(encodeFingerprint(x509.fingerprint256));
    expect(created.instanceId).toBe(deriveInstanceId(created.fingerprint));
    expect(created.certificate).toBe(x509.raw.toString('base64'));
    expect(readFileSync(created.keyPath, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
  });

  it('should load the identity once per service', async () => {
    const identities = service();
    const loading = identities.identity();

    expect(identities.identity()).toBe(loading);
    await loading;
  });

  it('should sign a challenge with the key of the certificate', async () => {
    const identities = service();
    const signature = await identities.signChallenge('nonce-1');
    const { certificatePath } = await identities.identity();

    expect(verify(
      'sha256',
      Buffer.from(registrationPayload('nonce-1')),
      { key: new X509Certificate(readFileSync(certificatePath)).publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )).toBe(true);
  });
});
