import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { Injectable } from '@nestjs/common';

import type { IClientConnection } from '../ports/client-transport.port.js';


@Injectable()
export class WebConnectionRegistryService {
  private readonly connections = new Map<string, IClientConnection>();

  register(connection: IClientConnection): void {
    this.connections.set(connection.id, connection);
    connection.onClose(() => this.connections.delete(connection.id));
  }

  broadcast(event: ServerEvent, exceptConnectionId?: string): void {
    for (const connection of this.connections.values()) {
      if (connection.id !== exceptConnectionId) {
        connection.send(event);
      }
    }
  }

  get size(): number {
    return this.connections.size;
  }
}
