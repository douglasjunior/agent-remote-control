import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload, SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { Inject, Injectable } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import { randomBytes, sign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFileOptions } from '../../storage/ports/locked-files.port.js';
import type { RemoteIdentity } from '../models/remote-identity.model.js';


/** Hosts that `REMOTE_URL` may reach over plain HTTP: this machine only, for development. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const CERTIFICATE_YEARS = 20;
const SIGNING_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
const IDENTITY_FILES: LockedFileOptions = { mode: 0o600, directoryMode: 0o700 };

/**
 * The settings of remote access and the identity of this host: the DTLS certificate whose fingerprint the remote link
 * pins and derives the instance id, with its key, kept in `<DATA_DIR>/remote`. They are created once, under the key's
 * lock so hosts that start together on one `DATA_DIR` create one pair, and the link stays the same across restarts.
 */
@Injectable()
export class RemoteIdentityService {
  private loading?: Promise<RemoteIdentity>;

  constructor(
    private readonly dataDirectory: DataDirectoryService,
    @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort,
  ) {}

  /**
   * Off unless `REMOTE_ENABLED` is `true`: whoever operates the signaling server serves the page that holds the
   * access token, so reaching this host through one is a choice of trust.
   */
  isEnabled(): boolean {
    return process.env.REMOTE_ENABLED === 'true';
  }

  /**
   * `REMOTE_URL`: the signaling server, which also serves the web app that opens the remote link and reads the access
   * token. It has no default, since choosing it is choosing whom to trust with the token. Null unless it is an HTTPS
   * URL, or an HTTP one of this machine.
   */
  baseUrl(): string | null {
    let url: URL;
    try {
      url = new URL(process.env.REMOTE_URL?.trim() ?? '');
    } catch {
      return null;
    }
    const trusted = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname));
    return trusted ? url.href.replace(/\/+$/, '') : null;
  }

  signalingUrl(baseUrl: string): string {
    return `${baseUrl.replace(/^http/, 'ws')}${SIGNALING_HOST_PATH}`;
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
    const certificateFile = this.files.text(certificatePath, IDENTITY_FILES);
    await this.files.text(keyPath, IDENTITY_FILES).update(async (key) => {
      if (key && await certificateFile.read()) {
        return undefined;
      }
      const created = await this.createCertificate();
      await certificateFile.update(() => created.certificate);
      return created.key;
    });
    const x509 = new X509Certificate((await certificateFile.read())!);
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
