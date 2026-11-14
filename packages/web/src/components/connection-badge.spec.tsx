import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectionBadge } from './connection-badge.js';


describe('ConnectionBadge', () => {
  it.each([
    ['websocket', 'WebSocket', /over a WebSocket/],
    ['webrtc', 'WebRTC, direct', /talk directly, peer to peer/],
    ['turn', 'WebRTC through a TURN relay', /a TURN relay forwards the messages/],
  ] as const)('should explain the %s transport on hover', async (transport, title, description) => {
    render(<ConnectionBadge status="open" transport={transport} />);

    await userEvent.hover(screen.getByRole('button', { name: `Connected over ${title}` }));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
  });

  it.each([
    ['connecting', 'Connecting'],
    ['closed', 'Disconnected'],
    ['unauthorized', 'Unauthorized'],
  ] as const)('should show the %s status', (status, label) => {
    render(<ConnectionBadge status={status} transport="websocket" />);

    expect(screen.getByRole('button')).toHaveTextContent(label);
  });

  it.each([
    ['incompatible', 'Incompatible', /cannot talk to\. Update the server/],
    ['untrusted', 'Untrusted', /presented a certificate other than the one in your link/],
  ] as const)('should explain why a %s host is refused', async (status, label, note) => {
    render(<ConnectionBadge status={status} transport="webrtc" />);

    await userEvent.click(screen.getByRole('button', { name: `${label} over WebRTC, direct` }));

    expect(await screen.findByText(note)).toBeInTheDocument();
  });
});
