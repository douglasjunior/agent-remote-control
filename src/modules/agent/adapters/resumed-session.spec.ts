import type { ClientConnection, SessionNotification } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';

import { ResumedSession } from './resumed-session.js';


type FakeConnection = {
  readonly connection: ClientConnection;
  readonly request: ReturnType<typeof vi.fn>;
};

function buildConnection(): FakeConnection {
  const request = vi.fn(async () => ({ stopReason: 'end_turn' }));
  return { connection: { agent: { request } } as unknown as ClientConnection, request };
}

function chunk(text: string, sessionId = 'stored'): SessionNotification {
  return { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } };
}


describe('ResumedSession', () => {
  it('should send the prompt to its own session through session/prompt', async () => {
    const { connection, request } = buildConnection();
    const session = new ResumedSession('stored', connection);

    await session.prompt('continue');

    expect(request).toHaveBeenCalledWith('session/prompt', {
      sessionId: 'stored',
      prompt: [{ type: 'text', text: 'continue' }],
    });
  });

  it('should deliver the routed updates and then the prompt response as the stop message', async () => {
    const { connection } = buildConnection();
    const session = new ResumedSession('stored', connection);

    session.route(chunk('Lembro da conversa.'));
    await session.prompt('continue');

    expect(await session.nextUpdate()).toEqual({
      kind: 'session_update',
      notification: chunk('Lembro da conversa.'),
      update: chunk('Lembro da conversa.').update,
    });
    expect(await session.nextUpdate()).toEqual({
      kind: 'stop',
      response: { stopReason: 'end_turn' },
      stopReason: 'end_turn',
    });
  });

  it('should hand an update to a reader already waiting for it', async () => {
    const { connection } = buildConnection();
    const session = new ResumedSession('stored', connection);

    const next = session.nextUpdate();
    session.route(chunk('ao vivo'));

    expect(await next).toEqual(expect.objectContaining({ kind: 'session_update' }));
  });

  it('should ignore updates of other sessions', async () => {
    const { connection } = buildConnection();
    const session = new ResumedSession('stored', connection);

    session.route(chunk('outra sessão', 'session-1'));
    await session.prompt('continue');

    expect(await session.nextUpdate()).toEqual(expect.objectContaining({ kind: 'stop' }));
  });

  it('should reject the waiting reader when the prompt fails', async () => {
    const { connection, request } = buildConnection();
    request.mockRejectedValueOnce(new Error('agent crashed'));
    const session = new ResumedSession('stored', connection);

    const next = session.nextUpdate();
    await expect(session.prompt('oi')).rejects.toThrow('agent crashed');

    await expect(next).rejects.toThrow('agent crashed');
  });

  it('should keep a prompt failure for the next reader when nobody is waiting', async () => {
    const { connection, request } = buildConnection();
    request.mockRejectedValueOnce(new Error('agent crashed'));
    const session = new ResumedSession('stored', connection);

    await expect(session.prompt('oi')).rejects.toThrow('agent crashed');

    await expect(session.nextUpdate()).rejects.toThrow('agent crashed');
  });

  it('should reject the waiting reader on dispose and every read after it', async () => {
    const { connection } = buildConnection();
    const session = new ResumedSession('stored', connection);

    const next = session.nextUpdate();
    session.dispose();

    await expect(next).rejects.toThrow('Resumed session disposed');
    await expect(session.nextUpdate()).rejects.toThrow('Resumed session disposed');
  });

  it('should drop what arrives after dispose', async () => {
    const { connection } = buildConnection();
    const session = new ResumedSession('stored', connection);

    session.dispose();
    session.route(chunk('tarde demais'));
    await session.prompt('oi');

    await expect(session.nextUpdate()).rejects.toThrow('Resumed session disposed');
  });
});
