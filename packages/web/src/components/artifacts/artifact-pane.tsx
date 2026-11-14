import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';

import { boardPath } from '../../artifacts/artifact-paths.js';
import { useBoard } from '../../artifacts/use-board.js';
import { useConnection } from '../../connection/connection-context.js';

import { ArtifactDetail } from './artifact-detail.js';


/** One artifact of the board, asked for whenever the connection opens and again whenever anyone changes it. */
export function ArtifactPane({ conversationId, artifactId }: { readonly conversationId: string; readonly artifactId: string }) {
  const { connection, status } = useConnection();
  const { board } = useBoard(conversationId);
  const detail = board.details[artifactId];

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'artifact.get', conversationId, id: artifactId });
    }
  }, [connection, status, conversationId, artifactId]);

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'artifact.updated' && event.conversationId === conversationId && event.artifact.id === artifactId) {
      connection.send({ type: 'artifact.get', conversationId, id: artifactId });
    }
  }), [connection, conversationId, artifactId]);

  if (board.loaded && !board.byId[artifactId]) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-muted-foreground">{`${artifactId} does not exist, or it was deleted.`}</p>
        <Link to={boardPath(conversationId)} className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          Back to the board
        </Link>
      </div>
    );
  }

  return (
    <div className="@container h-full overflow-y-auto">
      {detail
        ? <ArtifactDetail key={artifactId} conversationId={conversationId} artifact={detail} />
        : <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
    </div>
  );
}
