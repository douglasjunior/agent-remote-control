import { render, screen } from '@testing-library/react';

import { RemoteLinkMissingPage } from './remote-link-missing-page.js';


describe('RemoteLinkMissingPage', () => {
  it('should ask for the link the server printed', () => {
    render(<RemoteLinkMissingPage />);

    expect(screen.getByText('Open your server\'s link')).toBeInTheDocument();
    expect(screen.getByText(/Remote access link/)).toBeInTheDocument();
  });
});
