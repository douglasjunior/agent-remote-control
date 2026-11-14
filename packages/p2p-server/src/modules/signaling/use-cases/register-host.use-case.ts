import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { registrationPayload, SIGNALING_CLOSE_CODES } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, verify, X509Certificate } from 'node:crypto';

import type { HostSocket } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';

import { DisconnectHostUseCase } from './disconnect-host.use-case.js';


type Registration = {
  readonly instanceId: string;
  readonly certificate: string;
  readonly signature: string;
  readonly protocolVersion: number;
};

@Injectable()
export class RegisterHostUseCase {
  private readonly logger = new Logger(RegisterHostUseCase.name);
  /** `P2P_ALLOWED_INSTANCES`: when set, the only instances this server introduces browsers to. */
  private readonly allowedInstances = this.parseInstances(process.env.P2P_ALLOWED_INSTANCES);

  constructor(
    private readonly registry: SignalingRegistryService,
    private readonly disconnectHost: DisconnectHostUseCase,
  ) {}

  /** Sends the nonce the host must sign to register; returns it to check the registration against. */
  challenge(socket: HostSocket): string {
    const nonce = randomBytes(32).toString('base64url');
    socket.send({ type: 'host.challenge', nonce });
    return nonce;
  }

  /**
   * Gives the instance to the socket when the certificate derives its id and the signature of the nonce proves the
   * certificate's key, so the host never hands over anything that registers it again. A newer registration of the
   * same instance replaces the older one.
   */
  execute(socket: HostSocket, nonce: string, { instanceId, certificate, signature, protocolVersion }: Registration): boolean {
    if (!this.provesInstance(nonce, instanceId, certificate, signature)) {
      this.logger.warn(`host_rejected: instance=${instanceId}`);
      socket.close(SIGNALING_CLOSE_CODES.invalid, 'invalid registration');
      return false;
    }
    if (this.allowedInstances && !this.allowedInstances.has(instanceId)) {
      this.logger.warn(`host_forbidden: instance=${instanceId}`);
      socket.close(SIGNALING_CLOSE_CODES.forbidden, 'instance not allowed');
      return false;
    }
    const previous = this.registry.host(instanceId);
    if (previous) {
      this.disconnectHost.execute(previous.socket);
      previous.socket.close(SIGNALING_CLOSE_CODES.replaced, 'replaced');
    }
    this.registry.setHost({ instanceId, socket, protocolVersion });
    socket.send({ type: 'host.registered' });
    this.logger.log(`host_registered: instance=${instanceId}`);
    return true;
  }

  private provesInstance(nonce: string, instanceId: string, certificate: string, signature: string): boolean {
    try {
      const x509 = new X509Certificate(Buffer.from(certificate, 'base64'));
      return deriveInstanceId(encodeFingerprint(x509.fingerprint256)) === instanceId
        && verify('sha256', Buffer.from(registrationPayload(nonce)), { key: x509.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  private parseInstances(raw: string | undefined): ReadonlySet<string> | undefined {
    const instances = (raw ?? '').split(',').map(instance => instance.trim()).filter(instance => instance.length > 0);
    return instances.length > 0 ? new Set(instances) : undefined;
  }
}
