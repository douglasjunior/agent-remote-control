import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

import { Toaster } from '../components/ui/sonner.js';
import { ConnectionProvider } from '../connection/connection-context.js';
import { FakeServerConnection } from '../test/fake-server-connection.js';
import { ThemeProvider } from '../theme/theme-provider.js';

import { ArtifactsProvider, useArtifacts } from './artifacts-context.js';
import { useBoard, type Board } from './use-board.js';


function Probe({ onBoard }: { readonly onBoard: (board: Board) => void }) {
  const board = useBoard('c1');
  useEffect(() => {
    onBoard(board);
  });
  return <p>{`${Object.keys(board.board.byId).length} artifacts`}</p>;
}

function mount() {
  const connection = new FakeServerConnection();
  const boards: Board[] = [];
  render(
    <ThemeProvider>
      <ConnectionProvider connection={connection}>
        <ArtifactsProvider>
          <Probe onBoard={board => boards.push(board)} />
          <Toaster />
        </ArtifactsProvider>
      </ConnectionProvider>
    </ThemeProvider>,
  );
  act(() => connection.emitStatus('open'));
  return { connection, board: () => boards.at(-1)! };
}

function settle(connection: FakeServerConnection, result: { ok: true; id: string } | { ok: false; error: string }) {
  const { requestId } = connection.sent.at(-1) as { requestId: string };
  act(() => connection.emitEvent({ type: 'artifact.result', conversationId: 'c1', requestId, ...result }));
}

describe('ArtifactsProvider and useBoard', () => {
  it('asks for the projects whenever the connection opens and reads the board of the conversation', () => {
    const { connection } = mount();
    expect(connection.sent).toEqual([{ type: 'projects.list' }]);
    expect(screen.getByText('0 artifacts')).toBeInTheDocument();
    act(() => connection.emitEvent({ type: 'artifacts.list', conversationId: 'c1', artifacts: [] }));
    expect(screen.getByText('0 artifacts')).toBeInTheDocument();
  });

  it('sends every mutation for the conversation with a request id and settles it with the matching result', async () => {
    const { connection, board } = mount();
    let created!: ReturnType<Board['createArtifact']>;
    act(() => {
      created = board().createArtifact({ type: 'task', title: 'A', projectName: 'app', businessRefinement: false, technicalRefinement: false });
    });
    expect(connection.sent.at(-1)).toMatchObject({ type: 'artifact.create', conversationId: 'c1', artifact: { title: 'A' } });
    act(() => connection.emitEvent({ type: 'artifact.result', conversationId: 'c1', requestId: 'someone-else', ok: true, id: 'T-9' }));
    settle(connection, { ok: true, id: 'T-1' });
    await expect(created).resolves.toEqual({ ok: true, id: 'T-1' });

    let updated!: ReturnType<Board['updateArtifact']>;
    act(() => {
      updated = board().updateArtifact('T-1', { status: 'ready' });
    });
    expect(connection.sent.at(-1)).toMatchObject({ type: 'artifact.update', conversationId: 'c1', id: 'T-1', changes: { status: 'ready' } });
    settle(connection, { ok: false, error: 'Unknown artifact' });
    await expect(updated).resolves.toEqual({ ok: false, error: 'Unknown artifact' });
    expect(await screen.findByText('Unknown artifact')).toBeInTheDocument();

    act(() => {
      void board().commentArtifact('T-1', 'Hi');
      void board().deleteArtifact('T-1');
    });
    expect(connection.sent.slice(-2)).toMatchObject([
      { type: 'artifact.comment', conversationId: 'c1', id: 'T-1', text: 'Hi' },
      { type: 'artifact.delete', conversationId: 'c1', id: 'T-1' },
    ]);
  });

  it('settles pending mutations with an error when the connection drops', async () => {
    const { connection, board } = mount();
    let removed!: ReturnType<Board['deleteArtifact']>;
    act(() => {
      removed = board().deleteArtifact('T-1');
    });
    act(() => connection.emitStatus('closed'));
    await expect(removed).resolves.toEqual({ ok: false, error: 'The connection to the server was lost.' });
  });

  it('refuses to be used outside its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Outside() {
      useArtifacts();
      return null;
    }
    expect(() => render(<Outside />)).toThrow('useArtifacts must be used inside ArtifactsProvider');
  });
});
