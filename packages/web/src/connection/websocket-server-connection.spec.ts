import type { ServerEvent } from '@agent-remote-control/protocol/server-event';

import { AccessTokenStore } from './access-token-store.js';
import type { ConnectionStatus } from './server-connection.js';
import { WebSocketServerConnection } from './websocket-server-connection.js';


class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  serverClose(code = 1006) {
    this.onclose?.({ code });
  }
}

function latest() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

describe('WebSocketServerConnection', () => {
  let connection: WebSocketServerConnection;
  let tokens: AccessTokenStore;
  let statuses: ConnectionStatus[];
  let events: ServerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    localStorage.clear();
    tokens = new AccessTokenStore();
    tokens.store('secret');
    connection = new WebSocketServerConnection(tokens);
    statuses = [];
    events = [];
    connection.onStatus(status => statuses.push(status));
    connection.onEvent(event => events.push(event));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function authenticate() {
    connection.connect();
    latest().open();
    latest().receive({ type: 'auth.ok' });
  }

  it('connects to the relative /ws endpoint and authenticates first', () => {
    connection.connect();
    expect(latest().url).toBe(`ws://${location.host}/ws`);
    expect(statuses).toEqual(['connecting']);

    latest().open();
    expect(latest().sent).toEqual([{ type: 'auth', token: 'secret' }]);

    latest().receive({ type: 'auth.ok' });
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('uses wss on https pages', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' });
    connection.connect();
    expect(latest().url).toBe('wss://example.com/ws');
  });

  it('has a token when one is stored or comes in the link, and none once it is cleared', () => {
    expect(connection.hasAccessToken()).toBe(true);

    tokens.clear();
    expect(connection.hasAccessToken()).toBe(false);

    history.replaceState(null, '', '/#token=from-link');
    expect(connection.hasAccessToken()).toBe(true);
    expect(tokens.read()).toBe('from-link');
    history.replaceState(null, '', '/');
  });

  it('stores the token it is given', () => {
    connection.setAccessToken('given');

    expect(tokens.read()).toBe('given');
  });

  it('reports unauthorized without connecting when there is no token', () => {
    tokens.clear();
    connection.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(statuses).toEqual(['unauthorized']);
  });

  it('forwards valid events and drops invalid frames with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    authenticate();

    latest().receive({ type: 'conversation.list', conversations: [] });
    latest().receive('not json');
    latest().receive({ type: 'unknown' });

    expect(events).toEqual([{ type: 'conversation.list', conversations: [] }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listeners', () => {
    const extra: ServerEvent[] = [];
    const unsubscribeEvent = connection.onEvent(event => extra.push(event));
    const extraStatuses: ConnectionStatus[] = [];
    const unsubscribeStatus = connection.onStatus(status => extraStatuses.push(status));
    unsubscribeEvent();
    unsubscribeStatus();

    authenticate();
    latest().receive({ type: 'conversation.list', conversations: [] });

    expect(extra).toEqual([]);
    expect(extraStatuses).toEqual([]);
  });

  it('queues commands until authentication and flushes them in order', () => {
    connection.send({ type: 'conversation.list' });
    connection.connect();
    connection.send({ type: 'agents.list' });
    latest().open();
    expect(latest().sent).toEqual([{ type: 'auth', token: 'secret' }]);

    latest().receive({ type: 'auth.ok' });
    expect(latest().sent).toEqual([
      { type: 'auth', token: 'secret' },
      { type: 'conversation.list' },
      { type: 'agents.list' },
    ]);

    connection.send({ type: 'turn.cancel', conversationId: 'c1' });
    expect(latest().sent.at(-1)).toEqual({ type: 'turn.cancel', conversationId: 'c1' });
  });

  it('clears the token and stops on auth.failed', () => {
    connection.connect();
    latest().open();
    latest().receive({ type: 'auth.failed' });

    expect(statuses.at(-1)).toBe('unauthorized');
    expect(tokens.read()).toBeNull();
    expect(latest().closed).toBe(true);

    latest().serverClose(4401);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('treats close code 4401 as unauthorized', () => {
    connection.connect();
    latest().serverClose(4401);

    expect(statuses.at(-1)).toBe('unauthorized');
    expect(tokens.read()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects with exponential backoff capped at 10 s', () => {
    connection.connect();
    const delays = [500, 1000, 2000, 4000, 8000, 10_000, 10_000];

    delays.forEach((delay, index) => {
      latest().serverClose();
      expect(statuses.at(-1)).toBe('closed');
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(index + 2);
    });
  });

  it('resets the backoff after a successful authentication', () => {
    connection.connect();
    latest().serverClose();
    vi.advanceTimersByTime(500);
    latest().serverClose();
    vi.advanceTimersByTime(1000);
    latest().open();
    latest().receive({ type: 'auth.ok' });

    latest().serverClose();
    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
  });

  it('does not reconnect after disconnect', () => {
    authenticate();
    const socket = latest();
    connection.disconnect();

    expect(socket.closed).toBe(true);
    expect(statuses.at(-1)).toBe('closed');
    socket.serverClose();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('cancels a pending retry on disconnect and on connect', () => {
    connection.connect();
    latest().serverClose();
    connection.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    connection.connect();
    latest().serverClose();
    connection.connect();
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('ignores frames and closes from a replaced socket', () => {
    connection.connect();
    const stale = latest();
    connection.disconnect();
    connection.connect();

    stale.receive({ type: 'auth.ok' });
    stale.serverClose();
    expect(statuses.at(-1)).toBe('connecting');
  });
});
