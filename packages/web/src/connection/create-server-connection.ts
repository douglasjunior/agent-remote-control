import { AccessTokenStore } from './access-token-store.js';
import { readRemoteLink } from './remote-link.js';
import type { IServerConnection } from './server-connection.js';
import { WebRtcServerConnection } from './webrtc-server-connection.js';
import { WebSocketServerConnection } from './websocket-server-connection.js';


/** The connection of the app and the base path of its routes. */
export type AppConnection = {
  readonly connection: IServerConnection;
  readonly basename: string;
};

/**
 * The `p2p` build is the hosted web app, which reaches a host through WebRTC under `/i/<instance id>`; it has no
 * connection to open without the remote link. Any other build reaches the server that serves it.
 */
export function createAppConnection(mode: string): AppConnection | null {
  if (mode !== 'p2p') {
    return { connection: new WebSocketServerConnection(new AccessTokenStore()), basename: '/' };
  }
  const link = readRemoteLink();
  if (!link) {
    return null;
  }
  return {
    connection: new WebRtcServerConnection(new AccessTokenStore(`arc.accessToken.${link.instanceId}`), link),
    basename: `/i/${link.instanceId}`,
  };
}
