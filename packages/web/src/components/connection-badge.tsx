import type { ConnectionStatus } from '../connection/server-connection.js';

import { Badge } from './ui/badge.js';


const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  unauthorized: 'Unauthorized',
  closed: 'Disconnected',
};

export function ConnectionBadge({ status }: { readonly status: ConnectionStatus }) {
  return (
    <Badge variant={status === 'open' ? 'default' : status === 'connecting' ? 'secondary' : 'destructive'}>
      {LABELS[status]}
    </Badge>
  );
}
