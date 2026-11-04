import { WebAccessTokenService } from '../services/web-access-token.service.js';
import { WebConnectionRegistryService } from '../services/web-connection-registry.service.js';
import { FakeClientConnection, FakeClientTransport } from '../testing/fake-client-connection.js';

import { AUTH_FAILED_CLOSE_CODE, AUTH_TIMEOUT_MS, WebConnectionHandler } from './web-connection.handler.js';


describe('WebConnectionHandler', () => {
  let transport: FakeClientTransport;
  let registry: WebConnectionRegistryService;
  let handler: WebConnectionHandler;
  let connection: FakeClientConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    transport = new FakeClientTransport();
    registry = new WebConnectionRegistryService();
    handler = new WebConnectionHandler(transport, new WebAccessTokenService(), registry);
    handler.onModuleInit();
    connection = new FakeClientConnection();
    transport.connect(connection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('authenticates a correct token and registers the connection', () => {
    connection.receive({ type: 'auth', token: 'secret' });

    expect(connection.sent).toEqual([{ type: 'auth.ok' }]);
    expect(registry.size).toBe(1);
  });

  it('does not close an authenticated connection when the timeout elapses', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.closedWith).toBeUndefined();
  });

  it('rejects a wrong token with close code 4401', () => {
    connection.receive({ type: 'auth', token: 'wrong' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
    expect(registry.size).toBe(0);
  });

  it('rejects when no auth command arrives in time', () => {
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it('rejects any other first command without routing it', () => {
    connection.receive({ type: 'conversation.list' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(connection.closedWith?.code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it('ignores messages received after a rejection', () => {
    connection.receive({ type: 'auth', token: 'wrong' });
    connection.receive({ type: 'auth', token: 'secret' });

    expect(connection.sent).toEqual([{ type: 'auth.failed' }]);
    expect(registry.size).toBe(0);
  });

  it('cancels the timeout when the connection closes', () => {
    connection.simulateClose();
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(connection.sent).toEqual([]);
  });

  it('answers an invalid command from an authenticated connection with an error', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    connection.receive({ type: 'nope' });

    expect(connection.sent[1]).toEqual({ type: 'error', message: 'Invalid command' });
    expect(connection.closedWith).toBeUndefined();
  });

  it('answers conversation.list with an empty list', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    connection.receive({ type: 'conversation.list' });

    expect(connection.sent[1]).toEqual({ type: 'conversation.list', conversations: [] });
  });

  it('answers a valid command that has no route yet with an error', () => {
    connection.receive({ type: 'auth', token: 'secret' });
    connection.receive({ type: 'turn.cancel', conversationId: 'c' });

    expect(connection.sent[1]).toEqual({ type: 'error', message: 'Unsupported command: turn.cancel' });
  });

  it('stops listening for connections on module destroy', () => {
    handler.onModuleDestroy();

    expect(transport.listenerCount).toBe(0);
  });
});
