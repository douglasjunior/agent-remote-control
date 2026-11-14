import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { Injectable } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import type { RemoteIdentity } from '../models/remote-identity.model.js';


const DEFAULT_REMOTE_URL = 'https://arc-p2p-server.arc.douglasjunior.work';
const CERTIFICATE_YEARS = 20;
const SIGNING_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

/**
 * The settings of remote access and the identity of this host, kept in `<DATA_DIR>/remote`: a secret that derives
 * the instance id, and the DTLS certificate whose fingerprint the remote link pins. Both are created once, so the
 * link stays the same across restarts.
 */
@Injectable()
export class RemoteIdentityService {
  private loading?: Promise<RemoteIdentity>;

  constructor(private readonly dataDirectory: DataDirectoryService) {}

  isEnabled(): boolean {
    return process.env.REMOTE_ENABLED !== 'false';
  }

  /** `REMOTE_URL`: the signaling server, which also serves the web app that opens the remote link. */
  baseUrl(): string {
    return (process.env.REMOTE_URL?.trim() || DEFAULT_REMOTE_URL).replace(/\/+$/, '');
  }

  signalingUrl(): string {
    return `${this.baseUrl().replace(/^http/, 'ws')}${SIGNALING_HOST_PATH}`;
  }

  identity(): Promise<RemoteIdentity> {
    this.loading ??= this.loadOrCreate();
    return this.loading;
  }

  private async loadOrCreate(): Promise<RemoteIdentity> {
    const directory = join(this.dataDirectory.resolve(), 'remote');
    const secretPath = join(directory, 'secret');
    const certificatePath = join(directory, 'certificate.pem');
    const keyPath = join(directory, 'key.pem');
    mkdirSync(directory, { recursive: true });
    if (!existsSync(secretPath)) {
      writeFileSync(secretPath, randomBytes(32).toString('base64url'), { mode: 0o600 });
    }
    if (!existsSync(certificatePath) || !existsSync(keyPath)) {
      const { certificate, key } = await this.createCertificate();
      writeFileSync(keyPath, key, { mode: 0o600 });
      writeFileSync(certificatePath, certificate, { mode: 0o600 });
    }
    const secret = readFileSync(secretPath, 'utf8').trim();
    return {
      instanceId: await deriveInstanceId(secret),
      secret,
      fingerprint: encodeFingerprint(new X509Certificate(readFileSync(certificatePath)).fingerprint256),
      certificatePath,
      keyPath,
    };
  }

  /** A self-signed ECDSA certificate: WebRTC authenticates it by fingerprint, so no authority signs it. */
  private async createCertificate(): Promise<{ certificate: string; key: string }> {
    x509.cryptoProvider.set(crypto);
    const keys = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ['sign', 'verify']);
    const notBefore = new Date();
    const notAfter = new Date(notBefore);
    notAfter.setFullYear(notAfter.getFullYear() + CERTIFICATE_YEARS);
    const certificate = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: randomBytes(8).toString('hex'),
      name: 'CN=agent-remote-control',
      notBefore,
      notAfter,
      signingAlgorithm: SIGNING_ALGORITHM,
      keys,
    });
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
    const key = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
    return { certificate: certificate.toString('pem'), key };
  }
}
