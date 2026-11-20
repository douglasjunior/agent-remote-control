import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload } from '@agent-remote-control/protocol/signaling';
import { verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';

import { RemoteIdentityService } from './remote-identity.service.js';


describe('RemoteIdentityService', () => {
  let dataDir: string;
  let settings: StubRuntimeSettings;
  const service = () => new RemoteIdentityService(dataDirectoryAt(dataDir), createNodeLockedFiles(), settings);

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'remote-identity-'));
    settings = new StubRuntimeSettings();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should be enabled only when REMOTE_ENABLED is true, read on every call', () => {
    const remote = service();

    expect(remote.isEnabled()).toBe(false);
    settings.set('REMOTE_ENABLED', true);
    expect(remote.isEnabled()).toBe(true);
  });

  it.each([
    ['https://arc.example.com/', 'https://arc.example.com', 'wss://arc.example.com/signal/host'],
    [' http://localhost:3100/ ', 'http://localhost:3100', 'ws://localhost:3100/signal/host'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173', 'ws://127.0.0.1:5173/signal/host'],
    ['http://[::1]:3100', 'http://[::1]:3100', 'ws://[::1]:3100/signal/host'],
  ])('should reach REMOTE_URL %s over the matching WebSocket scheme', (remoteUrl, baseUrl, signalingUrl) => {
    settings.set('REMOTE_URL', remoteUrl);

    expect(service().baseUrl()).toBe(baseUrl);
    expect(service().signalingUrl(baseUrl)).toBe(signalingUrl);
  });

  it.each([
    ['empty', ''],
    ['plain HTTP to another machine', 'http://arc.example.com'],
  ])('should have no signaling server when REMOTE_URL is %s', (_name, remoteUrl) => {
    settings.set('REMOTE_URL', remoteUrl);

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

  it('should give hosts that start together on one data directory the same identity', async () => {
    const identities = await Promise.all([service().identity(), service().identity(), service().identity()]);

    expect(new Set(identities.map(identity => identity.fingerprint)).size).toBe(1);
    expect(readdirSync(join(dataDir, 'remote')).sort()).toEqual(['certificate.pem', 'key.pem']);
  });

  it('should create the pair again when the certificate is missing', async () => {
    const created = await service().identity();
    const key = readFileSync(created.keyPath, 'utf8');
    rmSync(created.certificatePath);

    const recreated = await service().identity();

    expect(recreated.fingerprint).not.toBe(created.fingerprint);
    expect(readFileSync(recreated.keyPath, 'utf8')).not.toBe(key);
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
