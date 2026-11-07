import { fireEvent, render, screen } from '@testing-library/react';

import { AttachmentChip } from './attachment-chip.js';


const renderChip = (props: Parameters<typeof AttachmentChip>[0]) => render(<ul><AttachmentChip {...props} /></ul>);

describe('AttachmentChip', () => {
  it('shows the file name with the full name as its title', () => {
    renderChip({ name: 'shot.png' });

    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveAttribute('title', 'shot.png');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a spinner while the file uploads', () => {
    renderChip({ name: 'shot.png', status: 'uploading' });

    expect(screen.getByLabelText('Uploading')).toBeInTheDocument();
  });

  it('shows the error as the title and for screen readers', () => {
    renderChip({ name: 'shot.png', status: 'error', error: 'File is too large' });

    expect(screen.getByRole('listitem')).toHaveAttribute('title', 'File is too large');
    expect(screen.getByText('File is too large')).toHaveClass('sr-only');
  });

  it('offers removal only when asked to', () => {
    const onRemove = vi.fn();
    renderChip({ name: 'shot.png', onRemove });

    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }));

    expect(onRemove).toHaveBeenCalledOnce();
  });
});
