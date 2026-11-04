import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectionProvider } from '../connection/connection-context.js';
import { FakeServerConnection } from '../test/fake-server-connection.js';

import { MissingTokenPage } from './missing-token-page.js';


describe('MissingTokenPage', () => {
  beforeEach(() => localStorage.clear());

  it('disables the button until a token is typed and stores it on submit', async () => {
    const user = userEvent.setup();
    render(<ConnectionProvider connection={new FakeServerConnection()}><MissingTokenPage /></ConnectionProvider>);

    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await user.type(screen.getByLabelText('Access token'), 'abc{Enter}');

    expect(localStorage.getItem('arc.accessToken')).toBe('abc');
  });
});
