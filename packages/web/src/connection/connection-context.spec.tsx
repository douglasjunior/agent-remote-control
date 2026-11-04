import { act, render, screen } from '@testing-library/react';

import { FakeServerConnection } from '../test/fake-server-connection.js';

import { storeAccessToken } from './access-token.js';
import { ConnectionProvider, useConnection } from './connection-context.js';


function Probe() {
  const { status, hasToken, submitToken } = useConnection();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="token">{String(hasToken)}</span>
      <button onClick={() => submitToken('  new  ')}>submit</button>
    </div>
  );
}

describe('ConnectionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('connects when a token is stored and disconnects on unmount', () => {
    storeAccessToken('t');
    const connection = new FakeServerConnection();
    const { unmount } = render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);

    expect(connection.connectCalls).toBe(1);
    act(() => connection.emitStatus('open'));
    expect(screen.getByTestId('status')).toHaveTextContent('open');

    unmount();
    expect(connection.disconnectCalls).toBe(1);
  });

  it('waits for a token, stores the submitted one and connects', () => {
    const connection = new FakeServerConnection();
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);
    expect(connection.connectCalls).toBe(0);
    expect(screen.getByTestId('token')).toHaveTextContent('false');

    act(() => screen.getByText('submit').click());
    expect(localStorage.getItem('arc.accessToken')).toBe('new');
    expect(connection.connectCalls).toBe(1);
    expect(screen.getByTestId('token')).toHaveTextContent('true');
  });

  it('drops the token flag when the connection is unauthorized', () => {
    storeAccessToken('t');
    const connection = new FakeServerConnection();
    render(<ConnectionProvider connection={connection}><Probe /></ConnectionProvider>);

    act(() => connection.emitStatus('unauthorized'));
    expect(screen.getByTestId('token')).toHaveTextContent('false');
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useConnection must be used inside ConnectionProvider');
    vi.restoreAllMocks();
  });
});
