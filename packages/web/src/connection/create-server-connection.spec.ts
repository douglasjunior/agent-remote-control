import { createAppConnection } from './create-server-connection.js';
import { WebRtcServerConnection } from './webrtc-server-connection.js';
import { WebSocketServerConnection } from './websocket-server-connection.js';


const INSTANCE = '0123456789abcdef0123';

describe('createAppConnection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('should reach the server of the page over WebSocket outside the p2p build', () => {
    const app = createAppConnection('production');

    expect(app?.connection).toBeInstanceOf(WebSocketServerConnection);
    expect(app?.basename).toBe('/');
  });

  it('should reach the host of the remote link over WebRTC under its instance path', () => {
    history.replaceState(null, '', `/i/${INSTANCE}#fp=pinned&token=t`);
    const app = createAppConnection('p2p');

    expect(app?.connection).toBeInstanceOf(WebRtcServerConnection);
    expect(app?.basename).toBe(`/i/${INSTANCE}`);
    expect(app?.connection.hasAccessToken()).toBe(true);
    expect(localStorage.getItem(`arc.accessToken.${INSTANCE}`)).toBe('t');
  });

  it('should have no connection in the p2p build without a remote link', () => {
    expect(createAppConnection('p2p')).toBeNull();
  });
});
