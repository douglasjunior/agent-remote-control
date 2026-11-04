import { parseClientCommand } from '@agent-remote-control/protocol/client-command';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { type IClientConnection, IClientTransportPort } from '../ports/client-transport.port.js';
import { WebAccessTokenService } from '../services/web-access-token.service.js';
import { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';


export const AUTH_TIMEOUT_MS = 5_000;
export const AUTH_FAILED_CLOSE_CODE = 4401;

@Injectable()
export class WebConnectionHandler implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    @Inject(IClientTransportPort) private readonly transport: IClientTransportPort,
    private readonly accessToken: WebAccessTokenService,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.transport.onConnection(connection => this.accept(connection));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private accept(connection: IClientConnection): void {
    let authenticated = false;
    let rejected = false;

    const reject = () => {
      rejected = true;
      connection.send({ type: 'auth.failed' });
      connection.close(AUTH_FAILED_CLOSE_CODE, 'unauthorized');
    };

    const timer = setTimeout(reject, AUTH_TIMEOUT_MS);
    connection.onClose(() => clearTimeout(timer));

    connection.onMessage((data) => {
      if (rejected) {
        return;
      }
      const parsed = parseClientCommand(data);
      if (!authenticated) {
        clearTimeout(timer);
        if (parsed.ok && parsed.value.type === 'auth' && this.accessToken.verify(parsed.value.token)) {
          authenticated = true;
          connection.send({ type: 'auth.ok' });
          this.registry.register(connection);
        } else {
          reject();
        }
        return;
      }
      if (!parsed.ok) {
        connection.send({ type: 'error', message: 'Invalid command' });
        return;
      }
      if (parsed.value.type === 'conversation.list') {
        connection.send({ type: 'conversation.list', conversations: [] });
        return;
      }
      connection.send({ type: 'error', message: `Unsupported command: ${parsed.value.type}` });
    });
  }
}
