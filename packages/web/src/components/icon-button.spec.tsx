import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { IconButton } from './icon-button.js';


describe('IconButton', () => {
  it('names the button with the label and shows it as a tooltip on hover', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="Send" onClick={onClick}><svg /></IconButton>);

    await user.hover(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Send', { selector: '[data-slot="tooltip-content"]' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows the tooltip when focused by keyboard', async () => {
    const user = userEvent.setup();
    render(<IconButton label="Stop"><svg /></IconButton>);

    await user.tab();

    expect(await screen.findByText('Stop', { selector: '[data-slot="tooltip-content"]' })).toBeInTheDocument();
  });
});
