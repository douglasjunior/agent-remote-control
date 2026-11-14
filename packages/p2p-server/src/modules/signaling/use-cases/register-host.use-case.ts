import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { SIGNALING_CLOSE_CODES } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger } from '@nestjs/common';

import type { HostSocket } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';

import { DisconnectHostUseCase } from './disconnect-host.use-case.js';


type Registration = { readonly instanceId: string; readonly secret: string; readonly protocolVersion: number };

@Injectable()
export class RegisterHostUseCase {
  private readonly logger = new Logger(RegisterHostUseCase.name);

  constructor(
    private readonly registry: SignalingRegistryService,
    private readonly disconnectHost: DisconnectHostUseCase,
  ) {}

  /**
   * Gives the instance to the socket when the secret derives its id, so nobody registers an instance whose secret
   * they do not hold. A newer registration of the same instance replaces the older one.
   */
  async execute(socket: HostSocket, { instanceId, secret, protocolVersion }: Registration): Promise<boolean> {
    if (await deriveInstanceId(secret) !== instanceId) {
      this.logger.warn(`host_rejected: instance=${instanceId}`);
      socket.close(SIGNALING_CLOSE_CODES.invalid, 'invalid secret');
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
}
