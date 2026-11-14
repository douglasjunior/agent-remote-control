import type { IClientConnection, IClientTransportPort } from '../ports/client-transport.port.js';


/** Hands the web channel the connections of every transport: the local WebSocket and the remote data channels. */
export class CombinedClientTransportAdapter implements IClientTransportPort {
  constructor(private readonly transports: readonly IClientTransportPort[]) {}

  onConnection(listener: (connection: IClientConnection) => void): () => void {
    const unsubscribes = this.transports.map(transport => transport.onConnection(listener));
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }
}
