import { act, render, screen } from '@testing-library/react';

import { FakeServerConnection } from '../test/fake-server-connection.js';

import { ConnectionProvider, useConnection } from './connection-context.js';


function Probe() {
  const { status, transport, hasToken, uploadLimits, submitToken } = useConnection();
  return (
    <div>
      <span data-testid="limits">{JSON.stringify(uploadLimits)}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="transport">{transport}</span>
      <span data-testid="token">{String(hasToken)}</span>
      <button onClick={() => submitToken('  new  ')}>submit</button>
    </div>
  );
}

describe('ConnectionProvider', () => {
  it('should follow the transport of the connection', () => {
    const connection = new FakeServerConnection();
    connection.transport = 'webrtc';
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);

    expect(screen.getByTestId('transport')).toHaveTextContent('webrtc');
    act(() => connection.emitTransport('turn'));
    expect(screen.getByTestId('transport')).toHaveTextContent('turn');
  });

  it('should keep the upload limits the server last told', () => {
    const connection = new FakeServerConnection();
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);
    expect(screen.getByTestId('limits')).toHaveTextContent('null');

    act(() => connection.emitEvent({ type: 'upload.limits', maxBytes: 1024, maxAttachments: 3 }));
    act(() => connection.emitEvent({ type: 'pong' }));

    expect(screen.getByTestId('limits')).toHaveTextContent('{"maxBytes":1024,"maxAttachments":3}');
  });

  it('should connect when a token is stored and disconnect on unmount', () => {
    const connection = new FakeServerConnection();
    const { unmount } = render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);

    expect(connection.connectCalls).toBe(1);
    act(() => connection.emitStatus('open'));
    expect(screen.getByTestId('status')).toHaveTextContent('open');

    unmount();
    expect(connection.disconnectCalls).toBe(1);
  });

  it('should wait for a token, store the submitted one and connect', () => {
    const connection = new FakeServerConnection();
    connection.accessToken = null;
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);
    expect(connection.connectCalls).toBe(0);
    expect(screen.getByTestId('token')).toHaveTextContent('false');

    act(() => screen.getByText('submit').click());
    expect(connection.accessToken).toBe('new');
    expect(connection.connectCalls).toBe(1);
    expect(screen.getByTestId('token')).toHaveTextContent('true');
  });

  it('should drop the token flag when the connection is unauthorized', () => {
    const connection = new FakeServerConnection();
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);

    act(() => connection.emitStatus('unauthorized'));
    expect(screen.getByTestId('token')).toHaveTextContent('false');
  });

  it('should throw outside the provider', () => {
    rs.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useConnection must be used inside ConnectionProvider');
    rs.restoreAllMocks();
  });
});
