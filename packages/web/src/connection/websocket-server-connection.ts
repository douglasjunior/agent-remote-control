import type { AccessTokenStore } from './access-token-store.js';
import { ChannelServerConnection, type ChannelHandlers, type ServerChannel } from './channel-server-connection.js';


const UNAUTHORIZED_CLOSE_CODE = 4401;

/** Reaches the server that serves the page, through its relative `/ws` endpoint. */
export class WebSocketServerConnection extends ChannelServerConnection {
  constructor(tokens: AccessTokenStore) {
    super(tokens, 'websocket');
  }

  /** The token goes in the `auth` message once the socket opens. */
  protected openChannel(_token: string, { onOpen, onMessage, onClose }: ChannelHandlers): ServerChannel {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.onopen = onOpen;
    socket.onmessage = message => onMessage(String(message.data));
    socket.onclose = event => onClose(event.code === UNAUTHORIZED_CLOSE_CODE ? 'unauthorized' : 'closed');
    return {
      send: text => socket.send(text),
      close: () => socket.close(),
    };
  }
}
