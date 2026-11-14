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

  protected openChannel(handlers: ChannelHandlers): ServerChannel {
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

  it('should stop watching the visibility after disconnect', () => {
    connection.connect();
    latest().handlers.onClose('closed');
    connection.disconnect();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(connection.channels).toHaveLength(1);
  });
});
