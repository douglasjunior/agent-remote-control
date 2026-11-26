import type { Squad } from '@agent-remote-control/protocol/squad';
import { useEffect, useState } from 'react';

import { useConnection } from '../../connection/connection-context.js';


/** The squads as the server last listed them, asked for again on every `open` status; `null` until the first answer. */
export function useSquads(): readonly Squad[] | null {
  const { connection, status } = useConnection();
  const [squads, setSquads] = useState<readonly Squad[] | null>(null);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'squads') {
      setSquads(event.squads);
    }
  }), [connection]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'squads.list' });
    }
  }, [connection, status]);

  return squads;
}
