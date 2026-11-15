import { ArrowLeftRight, Cable, type LucideIcon, Waypoints } from 'lucide-react';

import type { ConnectionStatus, ConnectionTransport } from '../connection/server-connection.js';

import { badgeVariants } from './ui/badge.js';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from './ui/popover.js';


const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  unauthorized: 'Unauthorized',
  closed: 'Disconnected',
  incompatible: 'Incompatible',
  untrusted: 'Untrusted',
};

const TRANSPORTS: Record<ConnectionTransport, { readonly icon: LucideIcon; readonly title: string; readonly description: string }> = {
  websocket: {
    icon: Cable,
    title: 'WebSocket',
    description: 'This page talks to the server that serves it over a WebSocket, on this machine or on its network.',
  },
  webrtc: {
    icon: ArrowLeftRight,
    title: 'WebRTC, direct',
    description: 'Your browser and your server talk directly, peer to peer, encrypted end to end. The signaling server only introduced them and carries none of the messages.',
  },
  turn: {
    icon: Waypoints,
    title: 'WebRTC through a TURN relay',
    description: 'No direct path exists between this network and your server\'s, so a TURN relay forwards the messages. They stay encrypted end to end and the relay cannot read them, but each one takes a longer way.',
  },
};

const STATUS_NOTES: Partial<Record<ConnectionStatus, string>> = {
  incompatible: 'Your server runs a version of Agent Remote Control this page cannot talk to. Update the server to connect.',
  untrusted: 'The server that answered presented a certificate other than the one in your link, so this page refused it. Open the link your server printed again.',
};

/** The connection status, with an icon of the transport whose popover, open on hover, explains it; below `sm` only the icon and the color show it. */
export function ConnectionBadge({ status, transport }: {
  readonly status: ConnectionStatus;
  readonly transport: ConnectionTransport;
}) {
  const { icon: Icon, title, description } = TRANSPORTS[transport];
  const note = STATUS_NOTES[status];
  const variant = status === 'open' ? 'default' : status === 'connecting' ? 'secondary' : 'destructive';

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={<button type="button" aria-label={`${LABELS[status]} over ${title}`} className={badgeVariants({ variant })} />}
      >
        <Icon data-icon="inline-start" aria-hidden />
        <span className="hidden sm:inline">{LABELS[status]}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
        {note && <p className="text-sm text-destructive">{note}</p>}
      </PopoverContent>
    </Popover>
  );
}
