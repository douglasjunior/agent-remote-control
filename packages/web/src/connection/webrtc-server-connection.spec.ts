import { toFrames } from '@agent-remote-control/protocol/data-channel-frames';
import { encodeFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';

import { AccessTokenStore } from './access-token-store.js';
import type { ConnectionStatus, ConnectionTransport } from './server-connection.js';
import { WebRtcServerConnection } from './webrtc-server-connection.js';


const INSTANCE = '0123456789abcdef0123';
const HEX = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0').toUpperCase()).join(':');
const OTHER_HEX = HEX.replace('00', 'FF');
const iceServers = [{ urls: ['stun:stun.example.com:3478'] }];
const answerSdp = (hex = HEX) => `v=0\r\na=fingerprint:sha-256 ${hex}\r\n`;

class FakeSignalingSocket {
  static readonly OPEN = 1;
  static instances: FakeSignalingSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    FakeSignalingSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

class FakeDataChannel {
  readyState = 'connecting';
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly label: string) {}

  send(text: string) {
    this.sent.push(text);
  }

  close() {
    this.readyState = 'closed';
  }

  open() {
    this.readyState = 'open';
    this.onopen?.();
  }

  receive(event: unknown) {
    toFrames(JSON.stringify(event)).forEach(frame => this.onmessage?.({ data: frame }));
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static failOffer = false;
  connectionState = 'new';
  channel?: FakeDataChannel;
  remote?: unknown;
  local?: unknown;
  readonly candidates: unknown[] = [];
  closed = false;
  stats = new Map<string, unknown>();
  onicecandidate: ((event: { candidate: { candidate: string; sdpMid: string | null } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(readonly config: unknown) {
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label: string) {
    this.channel = new FakeDataChannel(label);
    return this.channel;
  }

  async createOffer() {
    if (FakePeerConnection.failOffer) {
      throw new Error('no offer');
    }
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async setLocalDescription(description: unknown) {
    this.local = description;
  }

  async setRemoteDescription(description: unknown) {
    this.remote = description;
  }

  async addIceCandidate(candidate: unknown) {
    this.candidates.push(candidate);
  }

  async getStats() {
    return this.stats;
  }

  close() {
    this.closed = true;
  }

  changeState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

describe('WebRtcServerConnection', () => {
  let connection: WebRtcServerConnection;
  let statuses: ConnectionStatus[];
  let transports: ConnectionTransport[];
  let events: ServerEvent[];

  const socket = () => FakeSignalingSocket.instances.at(-1)!;
  const peer = () => FakePeerConnection.instances.at(-1)!;
  const flush = () => vi.advanceTimersByTimeAsync(0);

  const accept = async (protocolVersion = PROTOCOL_VERSION) => {
    connection.connect();
    socket().open();
    socket().receive({ type: 'client.accepted', iceServers, protocolVersion });
    await flush();
  };
  const negotiate = async () => {
    await accept();
    socket().receive({ type: 'session.answer', sdp: answerSdp() });
    await flush();
  };
  const openChannel = async () => {
    await negotiate();
    peer().channel!.open();
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSignalingSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    FakeSignalingSocket.instances = [];
    FakePeerConnection.instances = [];
    FakePeerConnection.failOffer = false;
    localStorage.clear();
    const tokens = new AccessTokenStore('arc.accessToken.remote');
    tokens.store('secret');
    connection = new WebRtcServerConnection(tokens, { instanceId: INSTANCE, fingerprint: encodeFingerprint(HEX) });
    statuses = [];
    transports = [];
    events = [];
    connection.onStatus(status => statuses.push(status));
    connection.onTransport(transport => transports.push(transport));
    connection.onEvent(event => events.push(event));
  });

  afterEach(() => {
    connection.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should ask the signaling server of the page for the instance', () => {
    connection.connect();
    socket().open();

    expect(connection.transport).toBe('webrtc');
    expect(socket().url).toBe(`ws://${location.host}/signal/client`);
    expect(socket().sent).toEqual([{ type: 'client.connect', instanceId: INSTANCE }]);
  });

  it('should use wss on https pages', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'arc.example.com' });
    connection.connect();

    expect(socket().url).toBe('wss://arc.example.com/signal/client');
  });

  it('should offer a data channel with the ICE servers and send its candidates', async () => {
    await accept();
    peer().onicecandidate!({ candidate: { candidate: 'c1', sdpMid: '0' } });
    peer().onicecandidate!({ candidate: { candidate: 'c2', sdpMid: null } });
    peer().onicecandidate!({ candidate: null });

    expect(peer().config).toEqual({ iceServers });
    expect(peer().channel!.label).toBe('arc');
    expect(socket().sent.slice(1)).toEqual([
      { type: 'client.offer', sdp: 'offer-sdp' },
      { type: 'client.candidate', candidate: 'c1', mid: '0' },
      { type: 'client.candidate', candidate: 'c2', mid: '0' },
    ]);
  });

  it('should take the pinned answer and the candidates of the host', async () => {
    await negotiate();
    socket().receive({ type: 'session.candidate', candidate: 'c3', mid: '0' });
    await flush();

    expect(peer().remote).toEqual({ type: 'answer', sdp: answerSdp() });
    expect(peer().candidates).toEqual([{ candidate: 'c3', sdpMid: '0' }]);
  });

  it('should authenticate over the open channel, leave the signaling server and exchange framed messages', async () => {
    await openChannel();
    const channel = peer().channel!;

    expect(socket().readyState).toBe(3);
    expect(channel.sent).toEqual(['0/1\n{"type":"auth","token":"secret"}']);
    channel.receive({ type: 'auth.ok' });
    channel.receive({ type: 'conversation.list', conversations: [] });
    connection.send({ type: 'turn.cancel', conversationId: 'c'.repeat(20_000) });
    peer().onicecandidate!({ candidate: { candidate: 'late', sdpMid: '0' } });

    expect(statuses).toEqual(['connecting', 'open']);
    expect(events).toEqual([{ type: 'conversation.list', conversations: [] }]);
    expect(channel.sent.slice(1)).toEqual(toFrames(JSON.stringify({ type: 'turn.cancel', conversationId: 'c'.repeat(20_000) })));
    expect(socket().sent.at(-1)).not.toEqual(expect.objectContaining({ candidate: 'late' }));
  });

  it('should report a direct connection', async () => {
    await openChannel();

    expect(transports).toEqual([]);
    expect(connection.transport).toBe('webrtc');
  });

  it('should report a relay on the pair the transport selected', async () => {
    await negotiate();
    peer().stats = new Map<string, unknown>([
      ['t', { type: 'transport', id: 't', selectedCandidatePairId: 'p' }],
      ['p', { type: 'candidate-pair', id: 'p', localCandidateId: 'l', remoteCandidateId: 'r' }],
      ['l', { type: 'local-candidate', id: 'l', candidateType: 'host' }],
      ['r', { type: 'remote-candidate', id: 'r', candidateType: 'relay' }],
    ]);
    peer().channel!.open();
    await flush();

    expect(transports).toEqual(['turn']);
  });

  it('should report a relay on the pair flagged selected', async () => {
    await negotiate();
    peer().stats = new Map<string, unknown>([
      ['p', { type: 'candidate-pair', id: 'p', selected: true, localCandidateId: 'l' }],
      ['l', { type: 'local-candidate', id: 'l', candidateType: 'relay' }],
    ]);
    peer().channel!.open();
    await flush();

    expect(transports).toEqual(['turn']);
  });

  it('should refuse a host whose certificate is not the pinned one, without retrying', async () => {
    await accept();
    socket().receive({ type: 'session.answer', sdp: answerSdp(OTHER_HEX) });
    await flush();
    vi.advanceTimersByTime(60_000);

    expect(statuses).toEqual(['connecting', 'untrusted']);
    expect(peer().remote).toBeUndefined();
    expect(peer().closed).toBe(true);
    expect(FakeSignalingSocket.instances).toHaveLength(1);
  });

  it('should refuse a host of another protocol version, without retrying', async () => {
    await accept(PROTOCOL_VERSION + 1);
    vi.advanceTimersByTime(60_000);

    expect(statuses).toEqual(['connecting', 'incompatible']);
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it.each([
    ['the host is offline', async () => socket().receive({ type: 'client.unavailable' })],
    ['the host gives up the session', async () => socket().receive({ type: 'session.closed' })],
    ['the signaling socket closes', async () => socket().serverClose()],
    ['the peer connection fails', async () => peer().changeState('failed')],
    [
      'the offer cannot be made', async () => {
        FakePeerConnection.failOffer = true;
        socket().receive({ type: 'client.accepted', iceServers, protocolVersion: PROTOCOL_VERSION });
      },
    ],
  ])('should retry with backoff when %s before the channel opens', async (_name, interrupt) => {
    await accept();
    await interrupt();
    await flush();

    expect(statuses.at(-1)).toBe('closed');
    vi.advanceTimersByTime(500);
    expect(FakeSignalingSocket.instances).toHaveLength(2);
  });

  it('should keep the channel when the signaling server goes away after it opens', async () => {
    await openChannel();
    socket().receive({ type: 'session.closed' });
    socket().serverClose();
    peer().changeState('connected');

    expect(statuses).toEqual(['connecting']);
  });

  it('should retry when the open channel closes', async () => {
    await openChannel();
    peer().channel!.onclose!();

    expect(statuses.at(-1)).toBe('closed');
    expect(peer().closed).toBe(true);
  });

  it('should drop invalid signals and close on invalid frames', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await accept();
    socket().receive('not json');
    socket().receive({ type: 'unknown' });
    expect(statuses).toEqual(['connecting']);

    socket().receive({ type: 'session.answer', sdp: answerSdp() });
    await flush();
    peer().channel!.open();
    peer().channel!.onmessage!({ data: 'no header' });

    expect(warn).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('should close everything on disconnect', async () => {
    await negotiate();
    const signaling = socket();
    const current = peer();
    connection.disconnect();
    current.channel!.onclose!();

    expect(signaling.readyState).toBe(3);
    expect(current.closed).toBe(true);
    expect(current.channel!.readyState).toBe('closed');
    expect(statuses.at(-1)).toBe('closed');
  });
});
