import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { X509Certificate } from 'node:crypto';
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

  it('should be enabled unless REMOTE_ENABLED is false', () => {
    expect(service().isEnabled()).toBe(true);
    vi.stubEnv('REMOTE_ENABLED', 'false');
    expect(service().isEnabled()).toBe(false);
  });

  it('should reach the default signaling server, or REMOTE_URL over the matching WebSocket scheme', () => {
    expect(service().baseUrl()).toBe('https://arc-p2p-server.arc.douglasjunior.work');
    expect(service().signalingUrl()).toBe('wss://arc-p2p-server.arc.douglasjunior.work/signal/host');
    vi.stubEnv('REMOTE_URL', ' http://localhost:3100/ ');
    expect(service().baseUrl()).toBe('http://localhost:3100');
    expect(service().signalingUrl()).toBe('ws://localhost:3100/signal/host');
  });

  it('should create the secret and the certificate once, readable by the owner only', async () => {
    const created = await service().identity();
    const reloaded = await service().identity();
    const directory = join(dataDir, 'remote');

    expect(reloaded).toEqual(created);
    expect(created).toMatchObject({
      certificatePath: join(directory, 'certificate.pem'),
      keyPath: join(directory, 'key.pem'),
    });
    for (const file of ['secret', 'certificate.pem', 'key.pem']) {
      expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
    }
    expect(created.instanceId).toBe(await deriveInstanceId(readFileSync(join(directory, 'secret'), 'utf8')));
    expect(created.fingerprint).toBe(encodeFingerprint(new X509Certificate(readFileSync(created.certificatePath)).fingerprint256));
    expect(readFileSync(created.keyPath, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
  });

  it('should load the identity once per service', async () => {
    const identities = service();
    const loading = identities.identity();

    expect(identities.identity()).toBe(loading);
    await loading;
  });
});
