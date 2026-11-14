import { SIGNALING_CLOSE_CODES, type ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ISignalingTransportPort } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';
import { SignalingModule } from '../signaling.module.js';
import { type FakeSignalingSocket, FakeSignalingTransport } from '../testing/fake-signaling-socket.js';
import { TEST_HOSTS } from '../testing/test-hosts.js';


const [HOST, OTHER_HOST] = TEST_HOSTS;
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const BROWSER_HEX = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':');
const BROWSER_FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const OFFER = `v=0\r\na=fingerprint:sha-256 ${BROWSER_HEX}\r\n`;
const PROOF = 'p'.repeat(43);
const UNKNOWN_SESSION = '6f1c0f0e-1f53-4c1e-9d55-6bb1f6c2a1a7';

describe('SignalingConnectionHandler', () => {
  let transport: FakeSignalingTransport;
  let registry: SignalingRegistryService;
  let close: () => Promise<void>;

  const nonceOf = (host: FakeSignalingSocket<ToHostSignal>) => {
    const challenge = host.sent[0];
    return challenge?.type === 'host.challenge' ? challenge.nonce : '';
  };

  const registerHost = (identity = HOST) => {
    const host = transport.connectHost();
    host.receive(identity!.register(nonceOf(host)));
    return host;
  };

  const connect = (instanceId = HOST!.instanceId) => {
    const client = transport.connectClient();
    client.receive({ type: 'client.connect', instanceId, fingerprint: BROWSER_FINGERPRINT, proof: PROOF });
    return client;
  };

  const requestSession = () => {
    const host = registerHost();
    const client = connect();
    const request = host.sent.at(-1) as Extract<ToHostSignal, { type: 'session.request' }>;
    return { host, client, sessionId: request.sessionId };
  };

  const acceptSession = () => {
    const session = requestSession();
    session.host.receive({ type: 'host.accept', sessionId: session.sessionId });
    return session;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    transport = new FakeSignalingTransport();
    const moduleRef = await Test.createTestingModule({ imports: [SignalingModule] })
      .overrideProvider(ISignalingTransportPort).useValue(transport)
      .compile();
    await moduleRef.init();
    registry = moduleRef.get(SignalingRegistryService);
    close = () => moduleRef.close();
  });

  afterEach(async () => {
    await close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('a host', () => {
    it('should be challenged and register by signing the nonce with the key of its certificate', () => {
      const host = registerHost();

      expect(host.sent).toEqual([{ type: 'host.challenge', nonce: expect.stringMatching(/^[\w-]{43}$/) }, { type: 'host.registered' }]);
      expect(registry.host(HOST!.instanceId)?.socket).toBe(host);
    });

    it.each([
      ['another instance than its certificate', (nonce: string) => ({ ...HOST!.register(nonce), instanceId: OTHER_HOST!.instanceId })],
      ['a signature of another nonce', () => HOST!.register('another nonce')],
      ['a certificate that does not parse', (nonce: string) => ({ ...HOST!.register(nonce), certificate: 'bm90IGEgY2VydGlmaWNhdGU' })],
    ])('should be refused for %s', (_name, registration) => {
      const host = transport.connectHost();
      const signal = registration(nonceOf(host));
      host.receive(signal);

      expect(host.closed).toEqual({ code: SIGNALING_CLOSE_CODES.invalid, reason: 'invalid registration' });
      expect(registry.host(signal.instanceId)).toBeUndefined();
    });

    it('should be refused when P2P_ALLOWED_INSTANCES leaves its instance out', async () => {
      vi.stubEnv('P2P_ALLOWED_INSTANCES', ` ${OTHER_HOST!.instanceId} , `);
      await close();
      const moduleRef = await Test.createTestingModule({ imports: [SignalingModule] })
        .overrideProvider(ISignalingTransportPort).useValue(transport = new FakeSignalingTransport())
        .compile();
      await moduleRef.init();
      registry = moduleRef.get(SignalingRegistryService);
      close = () => moduleRef.close();

      expect(registerHost().closed).toEqual({ code: SIGNALING_CLOSE_CODES.forbidden, reason: 'instance not allowed' });
      expect(registerHost(OTHER_HOST).sent.at(-1)).toEqual({ type: 'host.registered' });
    });

    it('should replace the older registration of its instance and end its sessions', () => {
      const { host: older, client } = requestSession();
      const newer = registerHost();

      expect(older.closed).toEqual({ code: SIGNALING_CLOSE_CODES.replaced, reason: 'replaced' });
      expect(client.sent.at(-1)).toEqual({ type: 'session.closed' });
      expect(client.closed).toEqual({ code: undefined, reason: undefined });
      older.emitClose();
      expect(registry.host(HOST!.instanceId)?.socket).toBe(newer);
    });

    it.each([
      ['an invalid signal', { type: 'nope' }, 'invalid signal'],
      ['a session signal before registering', { type: 'host.close', sessionId: UNKNOWN_SESSION }, 'not registered'],
    ])('should be closed for %s', (_name, signal, reason) => {
      const host = transport.connectHost();
      host.receive(signal);

      expect(host.closed).toEqual({ code: 1008, reason });
    });

    it('should be closed for registering twice', () => {
      const host = registerHost();
      host.receive(HOST!.register(nonceOf(host)));

      expect(host.closed).toEqual({ code: 1008, reason: 'registered twice' });
    });

    it('should be closed when it does not register in time', async () => {
      const host = transport.connectHost();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(host.closed).toEqual({ code: 1008, reason: 'no registration' });
    });

    it('should go offline when its socket closes', () => {
      registerHost().emitClose();

      expect(registry.host(HOST!.instanceId)).toBeUndefined();
    });

    it('should stay closed after a refused registration', () => {
      const host = transport.connectHost();
      host.receive(HOST!.register('another nonce'));
      host.receive({ type: 'host.close', sessionId: UNKNOWN_SESSION });
      host.emitClose();

      expect(host.closed).toEqual({ code: 1008, reason: 'not registered' });
    });
  });

  describe('a browser', () => {
    it('should have its proof handed to the host and get nothing before the host accepts it', () => {
      const { host, client, sessionId } = requestSession();

      expect(host.sent.at(-1)).toEqual({ type: 'session.request', sessionId, fingerprint: BROWSER_FINGERPRINT, proof: PROOF });
      expect(client.sent).toEqual([]);
    });

    it('should get the ICE servers and the protocol version once the host accepts, only once', () => {
      const { host, client, sessionId } = acceptSession();
      host.receive({ type: 'host.accept', sessionId });

      expect(client.sent).toEqual([{ type: 'client.accepted', iceServers: STUN, protocolVersion: 3 }]);
    });

    it('should hear that the host rejected its proof', () => {
      const { host, client, sessionId } = requestSession();
      host.receive({ type: 'host.reject', sessionId });

      expect(client.sent).toEqual([{ type: 'client.rejected' }]);
      expect(client.closed).toBeDefined();
      expect(registry.session(sessionId)).toBeUndefined();
    });

    it('should hear that the host is offline', () => {
      const client = connect();

      expect(client.sent).toEqual([{ type: 'client.unavailable' }]);
      expect(client.closed).toBeDefined();
    });

    it('should be refused past the sessions a host negotiates at once', () => {
      registerHost();
      const clients = Array.from({ length: 17 }, () => connect());

      expect(clients.at(-1)?.sent).toEqual([{ type: 'client.unavailable' }]);
      expect(registry.sessionCount(HOST!.instanceId)).toBe(16);
    });

    it('should relay the offer and the candidates between browser and host', () => {
      const { host, client, sessionId } = acceptSession();

      client.receive({ type: 'client.offer', sdp: OFFER });
      client.receive({ type: 'client.candidate', candidate: 'c1', mid: '0' });
      host.receive({ type: 'host.answer', sessionId, sdp: 'answer' });
      host.receive({ type: 'host.candidate', sessionId, candidate: 'c2', mid: '0' });

      expect(host.sent.slice(-2)).toEqual([
        { type: 'session.offer', sessionId, sdp: OFFER, iceServers: STUN },
        { type: 'session.candidate', sessionId, candidate: 'c1', mid: '0' },
      ]);
      expect(client.sent.slice(1)).toEqual([
        { type: 'session.answer', sdp: 'answer' },
        { type: 'session.candidate', candidate: 'c2', mid: '0' },
      ]);
    });

    it('should be closed past the candidates of a session', () => {
      const { client } = acceptSession();
      client.receive({ type: 'client.offer', sdp: OFFER });
      Array.from({ length: 32 }, () => client.receive({ type: 'client.candidate', candidate: 'c', mid: '0' }));
      expect(client.closed).toBeUndefined();

      client.receive({ type: 'client.candidate', candidate: 'c', mid: '0' });
      expect(client.closed).toEqual({ code: 1008, reason: 'unexpected client.candidate' });
    });

    it('should end the session the host gives up', () => {
      const { host, client, sessionId } = acceptSession();
      host.receive({ type: 'host.close', sessionId });

      expect(client.sent.at(-1)).toEqual({ type: 'session.closed' });
      expect(client.closed).toBeDefined();
      expect(registry.session(sessionId)).toBeUndefined();
    });

    it('should tell the host when the browser leaves', () => {
      const { host, client, sessionId } = acceptSession();
      client.emitClose();

      expect(host.sent.at(-1)).toEqual({ type: 'session.closed', sessionId });
      expect(registry.session(sessionId)).toBeUndefined();
    });

    it('should ignore signals of a host about sessions of another instance', () => {
      const { client, sessionId } = requestSession();
      const other = registerHost(OTHER_HOST);
      other.receive({ type: 'host.accept', sessionId });
      other.receive({ type: 'host.answer', sessionId: UNKNOWN_SESSION, sdp: 'answer' });

      expect(client.sent).toEqual([]);
    });

    it.each([
      ['an invalid signal', [{ type: 'nope' }], 'invalid signal'],
      ['an offer before connecting', [{ type: 'client.offer', sdp: OFFER }], 'unexpected client.offer'],
      ['an offer before the host accepts', ['connect', { type: 'client.offer', sdp: OFFER }], 'unexpected client.offer'],
      ['an offer of another certificate', ['connect', 'accept', { type: 'client.offer', sdp: 'v=0' }], 'unexpected client.offer'],
      ['a candidate before the offer', ['connect', 'accept', { type: 'client.candidate', candidate: 'c', mid: '0' }], 'unexpected client.candidate'],
      ['a second offer', ['connect', 'accept', { type: 'client.offer', sdp: OFFER }, { type: 'client.offer', sdp: OFFER }], 'unexpected client.offer'],
      ['connecting twice', ['connect', 'connect'], 'connected twice'],
    ])('should be closed for %s', (_name, steps, reason) => {
      const host = registerHost();
      const client = transport.connectClient();
      for (const step of steps) {
        if (step === 'connect') {
          client.receive({ type: 'client.connect', instanceId: HOST!.instanceId, fingerprint: BROWSER_FINGERPRINT, proof: PROOF });
        } else if (step === 'accept') {
          const request = host.sent.at(-1) as Extract<ToHostSignal, { type: 'session.request' }>;
          host.receive({ type: 'host.accept', sessionId: request.sessionId });
        } else {
          client.receive(step);
        }
      }

      expect(client.closed).toEqual({ code: 1008, reason });
    });

    it('should be closed for a signal after its host went offline', () => {
      const { host, client } = acceptSession();
      host.emitClose();
      client.closed = undefined;
      client.receive({ type: 'client.offer', sdp: OFFER });

      expect(client.closed).toEqual({ code: 1008, reason: 'unexpected client.offer' });
    });

    it('should be closed when it does not connect in time and after the negotiation time', async () => {
      const silent = transport.connectClient();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(silent.closed).toEqual({ code: 1008, reason: 'no connect' });

      const { client } = requestSession();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.closed).toEqual({ code: undefined, reason: undefined });
    });

    it('should leave nothing behind when it closes without a session', () => {
      transport.connectClient().emitClose();

      expect(registry.sessionCount(HOST!.instanceId)).toBe(0);
    });
  });
});
