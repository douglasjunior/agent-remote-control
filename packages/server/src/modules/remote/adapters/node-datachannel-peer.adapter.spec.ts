import type { IRemoteChannel } from '../ports/remote-peer.port.js';

import { NodeDataChannelPeerAdapter } from './node-datachannel-peer.adapter.js';


type Callback = (...args: never[]) => void;

class FakeNativeChannel {
  open = true;
  buffered = 0;
  readonly sent: string[] = [];
  closed = false;
  readonly callbacks: Record<string, Callback> = {};
  threshold?: number;

  getLabel = () => 'arc';
  isOpen = () => this.open;
  bufferedAmount = () => this.buffered;
  sendMessage = (text: string) => this.sent.push(text);
  close = () => {
    this.closed = true;
  };

  setBufferedAmountLowThreshold = (size: number) => {
    this.threshold = size;
  };

  onMessage = (callback: Callback) => this.on('message', callback);
  onClosed = (callback: Callback) => this.on('closed', callback);
  onBufferedAmountLow = (callback: Callback) => this.on('bufferedAmountLow', callback);

  emit(event: string, ...args: unknown[]): void {
    (this.callbacks[event] as (...values: unknown[]) => void)(...args);
  }

  private on(event: string, callback: Callback): void {
    this.callbacks[event] = callback;
  }
}

class FakeNativePeer {
  static instances: FakeNativePeer[] = [];
  readonly callbacks: Record<string, Callback> = {};
  remote?: [string, string];
  readonly candidates: [string, string][] = [];
  closed = false;

  constructor(readonly name: string, readonly config: unknown) {
    FakeNativePeer.instances.push(this);
  }

  setRemoteDescription = (sdp: string, type: string) => {
    this.remote = [sdp, type];
  };

  addRemoteCandidate = (candidate: string, mid: string) => this.candidates.push([candidate, mid]);
  close = () => {
    this.closed = true;
  };

  onStateChange = (callback: Callback) => this.on('state', callback);
  onLocalDescription = (callback: Callback) => this.on('description', callback);
  onLocalCandidate = (callback: Callback) => this.on('candidate', callback);
  onDataChannel = (callback: Callback) => this.on('channel', callback);

  emit(event: string, ...args: unknown[]): void {
    (this.callbacks[event] as (...values: unknown[]) => void)(...args);
  }

  private on(event: string, callback: Callback): void {
    this.callbacks[event] = callback;
  }
}

const cleanup = vi.fn();

vi.mock('node-datachannel', () => ({
  default: {
    PeerConnection: function PeerConnection(name: string, config: unknown) {
      return new FakeNativePeer(name, config);
    },
    cleanup: () => cleanup(),
  },
}));

describe('NodeDataChannelPeerAdapter', () => {
  const adapter = new NodeDataChannelPeerAdapter();
  const files = { certificatePath: '/c.pem', keyPath: '/k.pem' };

  const create = () => {
    const peer = adapter.create({ iceServers: [], ...files });
    return { peer, native: FakeNativePeer.instances.at(-1)! };
  };
  const openChannel = () => {
    const { peer, native } = create();
    let channel: IRemoteChannel | undefined;
    peer.onChannel((opened) => {
      channel = opened;
    });
    const nativeChannel = new FakeNativeChannel();
    native.emit('channel', nativeChannel);
    return { channel: channel!, nativeChannel };
  };

  it('should configure the pinned certificate and the ICE servers in the form libdatachannel reads', () => {
    adapter.create({
      iceServers: [
        { urls: ['stun:stun.example.com:3478'] },
        {
          urls: ['turn:t.example.com:3478?transport=udp', 'turn:t.example.com?transport=tcp', 'turns:t.example.com:443', 'turn:t.example.com'],
          username: '1:inst',
          credential: 'pass',
        },
      ],
      ...files,
    });

    const turn = { hostname: 't.example.com', username: '1:inst', password: 'pass' };
    expect(FakeNativePeer.instances.at(-1)!.config).toEqual({
      iceServers: [
        'stun:stun.example.com:3478',
        { ...turn, port: 3478, relayType: 'TurnUdp' },
        { ...turn, port: 3478, relayType: 'TurnTcp' },
        { ...turn, port: 443, relayType: 'TurnTls' },
        { ...turn, port: 3478, relayType: 'TurnUdp' },
      ],
      certificatePemFile: '/c.pem',
      keyPemFile: '/k.pem',
    });
  });

  it('should default the port of a TLS relay to 5349', () => {
    adapter.create({ iceServers: [{ urls: ['turns:t.example.com'] }], ...files });

    expect(FakeNativePeer.instances.at(-1)!.config).toMatchObject({ iceServers: [{ port: 5349, relayType: 'TurnTls' }] });
  });

  it('should answer an offer and relay the local description and candidates', () => {
    const { peer, native } = create();
    const answers: string[] = [];
    const candidates: [string, string][] = [];
    peer.onAnswer(sdp => answers.push(sdp));
    peer.onCandidate((candidate, mid) => candidates.push([candidate, mid]));

    peer.answer('offer');
    peer.addCandidate('c1', '0');
    native.emit('description', 'answer', 'answer');
    native.emit('candidate', 'c2', '0');

    expect(native.remote).toEqual(['offer', 'offer']);
    expect(native.candidates).toEqual([['c1', '0']]);
    expect(answers).toEqual(['answer']);
    expect(candidates).toEqual([['c2', '0']]);
  });

  it('should end once when the connection fails or closes', () => {
    const { peer, native } = create();
    const ended = vi.fn();
    peer.onEnd(ended);

    native.emit('state', 'connecting');
    native.emit('state', 'failed');
    native.emit('state', 'closed');
    peer.close();

    expect(ended).toHaveBeenCalledOnce();
    expect(native.closed).toBe(true);
  });

  it('should close without an end listener', () => {
    const { peer, native } = create();
    peer.close();

    expect(native.closed).toBe(true);
  });

  it('should exchange text over the channel while it is open', () => {
    const { channel, nativeChannel } = openChannel();
    const received: string[] = [];
    const unsubscribe = channel.onMessage(text => received.push(text));

    nativeChannel.emit('message', 'text');
    nativeChannel.emit('message', Buffer.from('buffer'));
    unsubscribe();
    nativeChannel.emit('message', 'late');
    channel.send('sent');
    nativeChannel.open = false;
    channel.send('dropped');

    expect(channel.label).toBe('arc');
    expect(received).toEqual(['text', 'buffer']);
    expect(nativeChannel.sent).toEqual(['sent']);
  });

  it('should report the close of the channel until unsubscribed', () => {
    const { channel, nativeChannel } = openChannel();
    const closed = vi.fn();
    const unsubscribe = channel.onClose(closed);

    nativeChannel.emit('closed');
    unsubscribe();
    nativeChannel.emit('closed');

    expect(closed).toHaveBeenCalledOnce();
  });

  it('should close the channel at once when nothing is buffered or it is already closed', () => {
    const empty = openChannel();
    empty.channel.close();
    const shut = openChannel();
    shut.nativeChannel.open = false;
    shut.nativeChannel.buffered = 10;
    shut.channel.close();

    expect(empty.nativeChannel.closed).toBe(true);
    expect(shut.nativeChannel.closed).toBe(true);
  });

  it('should close the channel after the buffered messages leave', () => {
    const { channel, nativeChannel } = openChannel();
    nativeChannel.buffered = 10;

    channel.close();
    expect(nativeChannel.closed).toBe(false);
    expect(nativeChannel.threshold).toBe(0);
    nativeChannel.emit('bufferedAmountLow');

    expect(nativeChannel.closed).toBe(true);
  });

  it('should release libdatachannel on shutdown', () => {
    adapter.onApplicationShutdown();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
