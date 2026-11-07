import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectionProvider } from '../connection/connection-context.js';
import { FakeServerConnection } from '../test/fake-server-connection.js';

import { MissingTokenPage } from './missing-token-page.js';


describe('MissingTokenPage', () => {
  it('disables the button until a token is typed and stores it on submit', async () => {
    const user = userEvent.setup();
    const connection = new FakeServerConnection();
    connection.accessToken = null;
    render(<ConnectionProvider connection={connection}><MissingTokenPage /></ConnectionProvider>);

    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await user.type(screen.getByLabelText('Access token'), 'abc{Enter}');

    expect(connection.accessToken).toBe('abc');
  });
});
