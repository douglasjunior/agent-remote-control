import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import { sessionProof } from '@agent-remote-control/protocol/session-proof';
import { registrationPayload } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import { verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AccessTokenService } from '../../access-token/services/access-token.service.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import type { IClientConnection } from '../../web/ports/client-transport.port.js';
import { RemoteIdentityService } from '../services/remote-identity.service.js';
import { FakeRemoteChannel, FakeRemotePeerFactory } from '../testing/fake-remote-peer.js';
import { FakeSignalingClient } from '../testing/fake-signaling-client.js';

import { RemoteClientTransportAdapter } from './remote-client-transport.adapter.js';


const TOKEN = 't'.repeat(32);
const iceServers = [{ urls: ['stun:stun.example.com:3478'] }];
const BROWSER_HEX = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':');
const BROWSER_FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const OFFER = `v=0\r\na=fingerprint:sha-256 ${BROWSER_HEX}\r\n`;
const sessionId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const SOURCE = 'AAECAwQFBgcICQoLDA0ODw';
const OTHER_SOURCE = 'DwAODQwLCgkIBwYFBAMCAQ';

describe('RemoteClientTransportAdapter', () => {
  let dataDir: string;
  let signaling: FakeSignalingClient;
  let peers: FakeRemotePeerFactory;
  let transport: RemoteClientTransportAdapter;
  let identity: RemoteIdentityService;
  let accessToken: AccessTokenService;
  let connections: IClientConnection[];
  let proof: string;
  let warn: ReturnType<typeof rs.spyOn>;

  const create = (client = signaling) => new RemoteClientTransportAdapter(identity, accessToken, client, peers);
  const request = (index = 1, withProof = proof, source = SOURCE) =>
    signaling.receive({ type: 'session.request', sessionId: sessionId(index), source, fingerprint: BROWSER_FINGERPRINT, proof: withProof });
  const wrongProof = () => `${proof[0] === 'A' ? 'B' : 'A'}${proof.slice(1)}`;
  const offer = (index = 1, sdp = OFFER) => signaling.receive({ type: 'session.offer', sessionId: sessionId(index), sdp, iceServers });
  /** A session the host accepted and answered. */
  const negotiate = (index = 1) => {
    request(index);
    offer(index);
    return peers.peers.at(-1)!;
  };

  beforeEach(async () => {
    rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    dataDir = mkdtempSync(join(tmpdir(), 'remote-transport-'));
    rs.stubEnv('REMOTE_ENABLED', 'true');
    rs.stubEnv('REMOTE_URL', 'http://localhost:3100');
    rs.stubEnv('WEB_ACCESS_TOKEN', TOKEN);
    identity = new RemoteIdentityService(dataDirectoryAt(dataDir));
    accessToken = new AccessTokenService(dataDirectoryAt(dataDir));
    signaling = new FakeSignalingClient();
    peers = new FakeRemotePeerFactory();
    transport = create();
    connections = [];
    transport.onConnection(connection => connections.push(connection));
    await transport.onApplicationBootstrap();
    proof = await sessionProof(TOKEN, (await identity.identity()).instanceId, BROWSER_FINGERPRINT);
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.unstubAllEnvs();
    rs.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should register by signing the challenge with the certificate\'s key and log the link', async () => {
    const { instanceId, certificate, certificatePath, fingerprint } = await identity.identity();
    const registration = await signaling.options!.register('nonce-1');

    expect(signaling.options!.url).toBe('ws://localhost:3100/signal/host');
    expect(registration).toMatchObject({ type: 'host.register', instanceId, certificate, protocolVersion: PROTOCOL_VERSION });
    expect(verify(
      'sha256',
      Buffer.from(registrationPayload('nonce-1')),
      { key: new X509Certificate(readFileSync(certificatePath)).publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(registration.signature, 'base64url'),
    )).toBe(true);
    expect(Logger.prototype.log).toHaveBeenCalledWith(`Remote access link: http://localhost:3100/i/${instanceId}#fp=${fingerprint}&token=${TOKEN}`);
  });

  it('should not reach the signaling server unless remote access is on', async () => {
    rs.stubEnv('REMOTE_ENABLED', '');
    const idle = new FakeSignalingClient();
    await create(idle).onApplicationBootstrap();

    expect(idle.options).toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['plain HTTP to another machine', 'http://arc.example.com'],
  ])('should stay off with REMOTE_URL %s', async (_name, remoteUrl) => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    rs.stubEnv('REMOTE_URL', remoteUrl);
    const idle = new FakeSignalingClient();
    await create(idle).onApplicationBootstrap();

    expect(idle.options).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Remote access off: REMOTE_URL must hold the HTTPS URL'));
  });

  it('should stay off with an access token too short to face the Internet', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    rs.stubEnv('WEB_ACCESS_TOKEN', 'short');
    accessToken = new AccessTokenService(dataDirectoryAt(dataDir));
    const idle = new FakeSignalingClient();
    await create(idle).onApplicationBootstrap();

    expect(idle.options).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Remote access off: the access token must hold at least 32 characters'));
  });

  it('should accept a session whose proof holds, before creating any peer', () => {
    request();

    expect(signaling.sent).toEqual([{ type: 'host.accept', sessionId: sessionId(1) }]);
    expect(peers.peers).toHaveLength(0);
  });

  it('should reject a wrong proof and check no request of its source until the backoff, which doubles per rejection', () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    const wrong = wrongProof();
    request(1, wrong);
    request(2);
    rs.advanceTimersByTime(1_000);
    request(3, wrong);
    rs.advanceTimersByTime(1_999);
    request(4);
    rs.advanceTimersByTime(1);
    request(5);
    request(6, wrong);
    rs.advanceTimersByTime(1_000);
    request(7);

    expect(signaling.sent).toEqual([
      { type: 'host.reject', sessionId: sessionId(1) },
      { type: 'host.close', sessionId: sessionId(2) },
      { type: 'host.reject', sessionId: sessionId(3) },
      { type: 'host.close', sessionId: sessionId(4) },
      { type: 'host.accept', sessionId: sessionId(5) },
      { type: 'host.reject', sessionId: sessionId(6) },
      { type: 'host.accept', sessionId: sessionId(7) },
    ]);
    expect(warn).toHaveBeenCalledWith('remote_session_rejected: rejections=2');
  });

  it('should keep checking the requests of other sources while one backs off', () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    request(1, wrongProof());
    request(2, wrongProof());
    request(3, proof, OTHER_SOURCE);

    expect(signaling.sent).toEqual([
      { type: 'host.reject', sessionId: sessionId(1) },
      { type: 'host.close', sessionId: sessionId(2) },
      { type: 'host.accept', sessionId: sessionId(3) },
    ]);
  });

  it('should forget the source rejected longest ago past the sources it remembers', () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    const sourceOf = (index: number) => `source-${String(index).padStart(15, '0')}`;
    Array.from({ length: 1_025 }, (_, index) => request(index + 1, wrongProof(), sourceOf(index)));
    signaling.sent.splice(0);
    request(2_000, proof, sourceOf(0));
    request(2_001, proof, sourceOf(1));

    expect(signaling.sent).toEqual([
      { type: 'host.accept', sessionId: sessionId(2_000) },
      { type: 'host.close', sessionId: sessionId(2_001) },
    ]);
  });

  it('should reject a proof that decodes to the right bytes through another encoding of its padding bits', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(proof.at(-1)!);
    request(1, `${proof.slice(0, -1)}${alphabet[last ^ 1]}`);

    expect(signaling.sent).toEqual([{ type: 'host.reject', sessionId: sessionId(1) }]);
  });

  it('should refuse a request past the sessions it negotiates at once and a repeated session', () => {
    Array.from({ length: 17 }, (_, index) => request(index + 1));
    request(1);

    expect(signaling.sent.slice(-2)).toEqual([
      { type: 'host.close', sessionId: sessionId(17) },
      { type: 'host.close', sessionId: sessionId(1) },
    ]);
  });

  it('should answer the offer of an accepted session with the pinned certificate and relay the negotiation', async () => {
    const peer = negotiate();
    peer.emitAnswer('answer');
    peer.emitCandidate('c1', '0');
    signaling.receive({ type: 'session.candidate', sessionId: sessionId(1), candidate: 'c2', mid: '0' });
    signaling.receive({ type: 'session.candidate', sessionId: sessionId(9), candidate: 'c3', mid: '0' });

    const { certificatePath, keyPath } = await identity.identity();
    expect(peer.options).toEqual({ iceServers, certificatePath, keyPath });
    expect(peer.offer).toBe(OFFER);
    expect(peer.candidates).toEqual([['c2', '0']]);
    expect(signaling.sent.slice(1)).toEqual([
      { type: 'host.answer', sessionId: sessionId(1), sdp: 'answer' },
      { type: 'host.candidate', sessionId: sessionId(1), candidate: 'c1', mid: '0' },
    ]);
  });

  it('should add no more candidates to a session than a browser may send', () => {
    const peer = negotiate();
    Array.from({ length: 40 }, () => signaling.receive({ type: 'session.candidate', sessionId: sessionId(1), candidate: 'c', mid: '0' }));

    expect(peer.candidates).toHaveLength(32);
  });

  it.each([
    ['of a session it did not accept', () => offer(2)],
    [
      'announcing another certificate than the proof', () => {
        request();
        offer(1, 'v=0\r\n');
      },
    ],
    [
      'repeated', () => {
        negotiate();
        signaling.sent.length = 0;
        offer();
      },
    ],
  ])('should give up an offer %s', (_name, act) => {
    act();

    expect(signaling.sent.at(-1)).toMatchObject({ type: 'host.close' });
    expect(peers.peers.every(peer => peer.closed)).toBe(true);
  });

  it.each([
    [
      'a candidate libdatachannel cannot read', () => {
        negotiate();
        signaling.receive({ type: 'session.candidate', sessionId: sessionId(1), candidate: 'malformed', mid: '0' });
      },
    ],
    [
      'an offer it cannot read', () => {
        peers.failNextAnswer = true;
        negotiate();
      },
    ],
    [
      'ICE servers it cannot use', () => {
        peers.failNextCreate = true;
        request();
        offer();
      },
    ],
  ])('should give up the session, and only it, for %s', (_name, act) => {
    act();

    expect(signaling.sent.at(-1)).toEqual({ type: 'host.close', sessionId: sessionId(1) });
    expect(peers.peers.every(peer => peer.closed)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^remote_signal_failed: session\.(candidate|offer): /));
  });

  it('should hand the data channel to the web channel and keep it when the browser leaves the signaling server', () => {
    const peer = negotiate();
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    signaling.receive({ type: 'session.closed', sessionId: sessionId(1) });

    expect(connections).toHaveLength(1);
    expect(peer.closed).toBe(false);
    connections[0]!.send({ type: 'auth.ok' });
    expect(channel.sent).toEqual(['0/1\n{"type":"auth.ok"}']);
  });

  it('should close the peer when its data channel closes', () => {
    const peer = negotiate();
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    channel.emitClose();

    expect(peer.closed).toBe(true);
  });

  it('should close the peer once when it ends before its data channel', () => {
    const peer = negotiate();
    const channel = new FakeRemoteChannel();
    peer.emitChannel(channel);
    peer.emitEnd();
    peer.closed = false;
    channel.emitClose();

    expect(peer.closed).toBe(false);
  });

  it('should refuse a second channel or a channel with another label', () => {
    const peer = negotiate();
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
    negotiate(1);
    negotiate(2);
    signaling.receive({ type: 'session.closed', sessionId: sessionId(1) });
    peers.peers[1]!.emitEnd();
    signaling.receive({ type: 'session.closed', sessionId: sessionId(3) });

    expect(peers.peers.map(peer => peer.closed)).toEqual([true, true]);
  });

  it('should give up a session that opens no channel in time', () => {
    rs.useFakeTimers();
    negotiate();
    rs.advanceTimersByTime(30_000);

    expect(peers.peers[0]!.closed).toBe(true);
    expect(signaling.sent.at(-1)).toEqual({ type: 'host.close', sessionId: sessionId(1) });
  });

  it('should ignore the registration confirmation', () => {
    signaling.receive({ type: 'host.registered' });

    expect(signaling.sent).toHaveLength(0);
  });

  it('should stop the signaling and close every peer on destroy', () => {
    negotiate(1);
    negotiate(2);
    transport.onModuleDestroy();

    expect(signaling.stopped).toBe(true);
    expect(peers.peers.every(peer => peer.closed)).toBe(true);
  });
});
