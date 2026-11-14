import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import type { IClientConnection } from '../../web/ports/client-transport.port.js';
import { RemoteIdentityService } from '../services/remote-identity.service.js';
import { FakeRemoteChannel, FakeRemotePeerFactory } from '../testing/fake-remote-peer.js';
import { FakeSignalingClient } from '../testing/fake-signaling-client.js';

import { RemoteClientTransportAdapter } from './remote-client-transport.adapter.js';


const iceServers = [{ urls: ['stun:stun.example.com:3478'] }];
const sessionId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('RemoteClientTransportAdapter', () => {
  let dataDir: string;
  let signaling: FakeSignalingClient;
  let peers: FakeRemotePeerFactory;
  let transport: RemoteClientTransportAdapter;
  let identity: RemoteIdentityService;
  let connections: IClientConnection[];

  const offer = (index = 1) => signaling.receive({ type: 'session.offer', sessionId: sessionId(index), sdp: `offer-${index}`, iceServers });

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'remote-transport-'));
    vi.stubEnv('REMOTE_URL', 'http://localhost:3100');
    identity = new RemoteIdentityService(dataDirectoryAt(dataDir));
    signaling = new FakeSignalingClient();
    peers = new FakeRemotePeerFactory();
    transport = new RemoteClientTransportAdapter(identity, signaling, peers);
    connections = [];
    transport.onConnection(connection => connections.push(connection));
    await transport.onApplicationBootstrap();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should register the instance with its secret and the protocol version', async () => {
    const { instanceId, secret } = await identity.identity();

    expect(signaling.options).toMatchObject({
      url: 'ws://localhost:3100/signal/host',
      registration: { type: 'host.register', instanceId, secret, protocolVersion: PROTOCOL_VERSION },
    });
  });

  it('should not reach the signaling server when remote access is off', async () => {
    vi.stubEnv('REMOTE_ENABLED', 'false');
    const idle = new FakeSignalingClient();
    await new RemoteClientTransportAdapter(identity, idle, peers).onApplicationBootstrap();

    expect(idle.options).toBeUndefined();
  });

  it('should answer an offer with the pinned certificate and relay the negotiation', async () => {
    offer();
    const peer = peers.peers[0]!;
    peer.emitAnswer('answer');
    peer.emitCandidate('c1', '0');
    signaling.receive({ type: 'session.candidate', sessionId: sessionId(1), candidate: 'c2', mid: '0' });
    signaling.receive({ type: 'session.candidate', sessionId: sessionId(9), candidate: 'c3', mid: '0' });

    expect(peer.options).toEqual({ iceServers, ...(({ certificatePath, keyPath }) => ({ certificatePath, keyPath }))(await identity.identity()) });
    expect(peer.offer).toBe('offer-1');
    expect(peer.candidates).toEqual([['c2', '0']]);
    expect(signaling.sent).toEqual([
      { type: 'host.answer', sessionId: sessionId(1), sdp: 'answer' },
      { type: 'host.candidate', sessionId: sessionId(1), candidate: 'c1', mid: '0' },
    ]);
  });

  it('should hand the data channel to the web channel and keep it when the browser leaves the signaling server', () => {
    offer();
    const peer = peers.peers[0]!;
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    signaling.receive({ type: 'session.closed', sessionId: sessionId(1) });

    expect(connections).toHaveLength(1);
    expect(peer.closed).toBe(false);
    connections[0]!.send({ type: 'auth.ok' });
    expect(channel.sent).toEqual(['0/1\n{"type":"auth.ok"}']);
  });

  it('should close the peer when its data channel closes', () => {
    offer();
    const peer = peers.peers[0]!;
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    channel.emitClose();

    expect(peer.closed).toBe(true);
  });

  it('should close the peer once when it ends before its data channel', () => {
    offer();
    const peer = peers.peers[0]!;
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    peer.emitEnd();
    peer.closed = false;
    channel.emitClose();

    expect(peer.closed).toBe(false);
  });

  it('should refuse a second channel or a channel with another label', () => {
    offer();
    const peer = peers.peers[0]!;
    const other = new FakeRemoteChannel('other');
    const first = new FakeRemoteChannel();
    const second = new FakeRemoteChannel();
    peer.emitChannel(other);
    peer.emitChannel(first);
    peer.emitChannel(second);

    expect(other.closed).toBe(true);
    expect(second.closed).toBe(true);
    expect(connections).toHaveLength(1);
  });

  it('should drop a negotiation the browser left or that ended', () => {
    offer(1);
    offer(2);
    signaling.receive({ type: 'session.closed', sessionId: sessionId(1) });
    peers.peers[1]!.emitEnd();
    signaling.receive({ type: 'session.closed', sessionId: sessionId(3) });

    expect(peers.peers.map(peer => peer.closed)).toEqual([true, true]);
  });

  it('should give up a negotiation that opens no channel in time', () => {
    vi.useFakeTimers();
    offer();
    vi.advanceTimersByTime(30_000);

    expect(peers.peers[0]!.closed).toBe(true);
    expect(signaling.sent).toEqual([{ type: 'host.close', sessionId: sessionId(1) }]);
  });

  it('should give up an offer it cannot read', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    peers.failNextAnswer = true;
    offer();

    expect(peers.peers[0]!.closed).toBe(true);
    expect(signaling.sent).toEqual([{ type: 'host.close', sessionId: sessionId(1) }]);
  });

  it('should refuse an offer past the negotiations it holds at once and a repeated session', () => {
    Array.from({ length: 17 }, (_, index) => offer(index + 1));
    offer(1);

    expect(peers.peers).toHaveLength(16);
    expect(signaling.sent).toEqual([
      { type: 'host.close', sessionId: sessionId(17) },
      { type: 'host.close', sessionId: sessionId(1) },
    ]);
  });

  it('should ignore the registration confirmation', () => {
    signaling.receive({ type: 'host.registered' });

    expect(peers.peers).toHaveLength(0);
  });

  it('should stop the signaling and close every peer on destroy', () => {
    offer(1);
    offer(2);
    transport.onModuleDestroy();

    expect(signaling.stopped).toBe(true);
    expect(peers.peers.every(peer => peer.closed)).toBe(true);
  });
});
