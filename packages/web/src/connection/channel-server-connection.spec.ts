import { AccessTokenStore } from './access-token-store.js';
import { ChannelServerConnection, type ChannelHandlers, type ServerChannel } from './channel-server-connection.js';
import type { ConnectionStatus, ConnectionTransport } from './server-connection.js';


class TestChannel implements ServerChannel {
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly handlers: ChannelHandlers) {}

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.closed = true;
  }
}

class TestConnection extends ChannelServerConnection {
  readonly channels: TestChannel[] = [];

  constructor(tokens: AccessTokenStore) {
    super(tokens, 'webrtc');
  }

  readonly openedWith: string[] = [];

  protected openChannel(token: string, handlers: ChannelHandlers): ServerChannel {
    this.openedWith.push(token);
    const channel = new TestChannel(handlers);
    this.channels.push(channel);
    return channel;
  }
}

describe('ChannelServerConnection', () => {
  let connection: TestConnection;
  let statuses: ConnectionStatus[];
  let transports: ConnectionTransport[];
  let visibility: DocumentVisibilityState;

  const latest = () => connection.channels.at(-1)!;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    const tokens = new AccessTokenStore();
    tokens.store('secret');
    connection = new TestConnection(tokens);
    statuses = [];
    transports = [];
    connection.onStatus(status => statuses.push(status));
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => {
    connection.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should open each channel with the stored access token', () => {
    connection.connect();

    expect(connection.openedWith).toEqual(['secret']);
  });

  it('should report the transport it starts with and the one the channel finds, once each', () => {
    const unsubscribe = connection.onTransport(transport => transports.push(transport));
    connection.connect();
    latest().handlers.onTransport('webrtc');
    latest().handlers.onTransport('turn');
    latest().handlers.onTransport('turn');
    unsubscribe();
    latest().handlers.onTransport('webrtc');

    expect(transports).toEqual(['turn']);
    expect(connection.transport).toBe('webrtc');
  });

  it.each(['incompatible', 'untrusted'] as const)('should stop without retrying when the channel closes as %s', (reason) => {
    connection.connect();
    connection.send({ type: 'conversation.list' });
    latest().handlers.onClose(reason);
    vi.advanceTimersByTime(60_000);

    expect(statuses).toEqual(['connecting', reason]);
    expect(connection.channels).toHaveLength(1);
  });

  it('should ignore the reports of a channel it replaced', () => {
    connection.connect();
    const stale = latest();
    connection.connect();
    stale.handlers.onOpen();
    stale.handlers.onTransport('turn');
    stale.handlers.onClose('closed');

    expect(stale.sent).toEqual([]);
    expect(connection.transport).toBe('webrtc');
    expect(statuses).toEqual(['connecting']);
  });

  it('should retry at once when the page becomes visible again', () => {
    connection.connect();
    latest().handlers.onClose('closed');
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(connection.channels).toHaveLength(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(connection.channels).toHaveLength(2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(connection.channels).toHaveLength(2);
  });

  describe('heartbeat', () => {
    const authenticate = () => {
      connection.connect();
      latest().handlers.onMessage('{"type":"auth.ok"}');
    };
    const pings = (channel = latest()) => channel.sent.filter(text => text === '{"type":"ping"}').length;

    it('should ping every 5 s once authenticated and keep a connection that answers', () => {
      const events: unknown[] = [];
      connection.onEvent(event => events.push(event));
      connection.connect();
      vi.advanceTimersByTime(30_000);
      expect(pings()).toBe(0);

      latest().handlers.onMessage('{"type":"auth.ok"}');
      for (let beat = 0; beat < 4; beat += 1) {
        vi.advanceTimersByTime(5_000);
        latest().handlers.onMessage('{"type":"pong"}');
      }

      expect(pings()).toBe(4);
      expect(events).toEqual([]);
      expect(statuses).toEqual(['connecting', 'open']);
    });

    it('should take any message from the server as an answer', () => {
      authenticate();
      vi.advanceTimersByTime(5_000);
      latest().handlers.onMessage('{"type":"conversation.list","conversations":[]}');
      vi.advanceTimersByTime(10_000);

      expect(statuses.at(-1)).toBe('open');
      expect(pings()).toBe(2);
    });

    it('should drop a connection whose ping goes unanswered for 10 s and reconnect', () => {
      authenticate();
      const silent = latest();
      vi.advanceTimersByTime(5_000);
      vi.advanceTimersByTime(5_000);
      expect(statuses.at(-1)).toBe('open');

      vi.advanceTimersByTime(5_000);
      expect(statuses.at(-1)).toBe('closed');
      expect(silent.closed).toBe(true);
      expect(pings(silent)).toBe(1);

      vi.advanceTimersByTime(500);
      expect(connection.channels).toHaveLength(2);
    });

    it.each([
      ['the connection disconnects', () => connection.disconnect()],
      ['the channel closes', () => latest().handlers.onClose('closed')],
      ['the token is refused', () => latest().handlers.onMessage('{"type":"auth.failed"}')],
    ])('should stop when %s', (_name, stop) => {
      authenticate();
      const channel = latest();
      stop();
      vi.advanceTimersByTime(60_000);

      expect(pings(channel)).toBe(0);
    });
  });

  it('should stop watching the visibility after disconnect', () => {
    connection.connect();
    latest().handlers.onClose('closed');
    connection.disconnect();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(connection.channels).toHaveLength(1);
  });
});
