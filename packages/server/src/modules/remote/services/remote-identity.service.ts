import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload, SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { Injectable } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import { randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import type { RemoteIdentity } from '../models/remote-identity.model.js';


const DEFAULT_REMOTE_URL = 'https://arc-p2p-server.arc.douglasjunior.work';
const CERTIFICATE_YEARS = 20;
const SIGNING_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

/**
 * The settings of remote access and the identity of this host: the DTLS certificate whose fingerprint the remote link
 * pins and derives the instance id, with its key, kept in `<DATA_DIR>/remote`. They are created once, so the link
 * stays the same across restarts.
 */
@Injectable()
export class RemoteIdentityService {
  private loading?: Promise<RemoteIdentity>;

  constructor(private readonly dataDirectory: DataDirectoryService) {}

  /**
   * Off unless `REMOTE_ENABLED` is `true`: whoever operates the signaling server serves the page that holds the
   * access token, so reaching this host through one is a choice of trust.
   */
  isEnabled(): boolean {
    return process.env.REMOTE_ENABLED === 'true';
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

  /** Signs the nonce of the signaling server's challenge with the certificate's key, once the identity is loaded. */
  async signChallenge(nonce: string): Promise<string> {
    const { keyPath } = await this.identity();
    return sign('sha256', Buffer.from(registrationPayload(nonce)), { key: readFileSync(keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  }

  private async loadOrCreate(): Promise<RemoteIdentity> {
    const directory = join(this.dataDirectory.resolve(), 'remote');
    const certificatePath = join(directory, 'certificate.pem');
    const keyPath = join(directory, 'key.pem');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existsSync(certificatePath) || !existsSync(keyPath)) {
      const { certificate, key } = await this.createCertificate();
      writeFileSync(keyPath, key, { mode: 0o600 });
      writeFileSync(certificatePath, certificate, { mode: 0o600 });
    }
    const x509 = new X509Certificate(readFileSync(certificatePath));
    const fingerprint = encodeFingerprint(x509.fingerprint256);
    return {
      instanceId: deriveInstanceId(fingerprint),
      fingerprint,
      certificate: x509.raw.toString('base64'),
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
