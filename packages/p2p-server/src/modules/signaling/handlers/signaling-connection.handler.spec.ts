import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import { SIGNALING_CLOSE_CODES } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ISignalingTransportPort } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';
import { SignalingModule } from '../signaling.module.js';
import { FakeSignalingTransport } from '../testing/fake-signaling-socket.js';
import { RegisterHostUseCase } from '../use-cases/register-host.use-case.js';


const SECRET = 'host-secret';
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

describe('SignalingConnectionHandler', () => {
  let transport: FakeSignalingTransport;
  let registry: SignalingRegistryService;
  let instanceId: string;
  let close: () => Promise<void>;
  let registrations: Promise<boolean>[];

  /** Waits for the registrations, which hash the secret off the main thread, and for the handler to take them. */
  const flush = async () => {
    await Promise.all(registrations);
    await Promise.resolve();
  };

  const registerHost = async () => {
    const host = transport.connectHost();
    host.receive({ type: 'host.register', instanceId, secret: SECRET, protocolVersion: 3 });
    await flush();
    return host;
  };

  const connectClient = async () => {
    const host = await registerHost();
    const client = transport.connectClient();
    client.receive({ type: 'client.connect', instanceId });
    const sessionId = [...registry['sessions'].keys()][0]!;
    return { host, client, sessionId };
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    instanceId = await deriveInstanceId(SECRET);
    transport = new FakeSignalingTransport();
    const moduleRef = await Test.createTestingModule({ imports: [SignalingModule] })
      .overrideProvider(ISignalingTransportPort).useValue(transport)
      .compile();
    await moduleRef.init();
    registry = moduleRef.get(SignalingRegistryService);
    const registerHostUseCase = moduleRef.get(RegisterHostUseCase);
    const execute = registerHostUseCase.execute.bind(registerHostUseCase);
    registrations = [];
    vi.spyOn(registerHostUseCase, 'execute').mockImplementation((...args) => {
      const registration = execute(...args);
      registrations.push(registration);
      return registration;
    });
    close = () => moduleRef.close();
  });

  afterEach(async () => {
    await close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('a host', () => {
    it('should register when its secret derives the instance id', async () => {
      const host = await registerHost();

      expect(host.sent).toEqual([{ type: 'host.registered' }]);
      expect(registry.host(instanceId)?.socket).toBe(host);
    });

    it('should be refused when its secret does not derive the instance id', async () => {
      const host = transport.connectHost();
      host.receive({ type: 'host.register', instanceId: '0123456789abcdef0123', secret: SECRET, protocolVersion: 1 });
      await flush();

      expect(host.closed).toEqual({ code: SIGNALING_CLOSE_CODES.invalid, reason: 'invalid secret' });
      expect(registry.host('0123456789abcdef0123')).toBeUndefined();
    });

    it('should replace the older registration of its instance and end its sessions', async () => {
      const { host: older, client } = await connectClient();
      const newer = await registerHost();

      expect(older.closed).toEqual({ code: SIGNALING_CLOSE_CODES.replaced, reason: 'replaced' });
      expect(client.sent.at(-1)).toEqual({ type: 'session.closed' });
      expect(client.closed).toEqual({ code: undefined, reason: undefined });
      older.emitClose();
      expect(registry.host(instanceId)?.socket).toBe(newer);
    });

    it.each([
      ['an invalid signal', { type: 'nope' }, 'invalid signal'],
      ['a session signal before registering', { type: 'host.close', sessionId: '6f1c0f0e-1f53-4c1e-9d55-6bb1f6c2a1a7' }, 'not registered'],
    ])('should be closed for %s', async (_name, signal, reason) => {
      const host = transport.connectHost();
      host.receive(signal);

      expect(host.closed).toEqual({ code: 1008, reason });
    });

    it('should be closed for registering twice', async () => {
      const host = await registerHost();
      host.receive({ type: 'host.register', instanceId, secret: SECRET, protocolVersion: 3 });

      expect(host.closed).toEqual({ code: 1008, reason: 'registered twice' });
    });

    it('should be closed when it does not register in time', async () => {
      const host = transport.connectHost();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(host.closed).toEqual({ code: 1008, reason: 'no registration' });
    });

    it('should go offline when its socket closes', async () => {
      const host = await registerHost();
      host.emitClose();

      expect(registry.host(instanceId)).toBeUndefined();
    });

    it('should not stay online when its socket closes while it registers', async () => {
      const host = transport.connectHost();
      host.receive({ type: 'host.register', instanceId, secret: SECRET, protocolVersion: 3 });
      host.emitClose();
      await flush();

      expect(registry.host(instanceId)).toBeUndefined();
    });

    it('should stay closed after a refused registration', async () => {
      const host = transport.connectHost();
      host.receive({ type: 'host.register', instanceId: '0123456789abcdef0123', secret: SECRET, protocolVersion: 1 });
      await flush();
      host.receive({ type: 'host.close', sessionId: '6f1c0f0e-1f53-4c1e-9d55-6bb1f6c2a1a7' });

      expect(host.closed).toEqual({ code: 1008, reason: 'not registered' });
    });
  });

  describe('a browser', () => {
    it('should get the ICE servers and the protocol version of an online host', async () => {
      const { client } = await connectClient();

      expect(client.sent).toEqual([{ type: 'client.accepted', iceServers: STUN, protocolVersion: 3 }]);
    });

    it('should hear that the host is offline', () => {
      const client = transport.connectClient();
      client.receive({ type: 'client.connect', instanceId: '0123456789abcdef0123' });

      expect(client.sent).toEqual([{ type: 'client.unavailable' }]);
      expect(client.closed).toBeDefined();
    });

    it('should be refused past the sessions a host negotiates at once', async () => {
      await registerHost();
      const clients = Array.from({ length: 17 }, () => {
        const client = transport.connectClient();
        client.receive({ type: 'client.connect', instanceId });
        return client;
      });

      expect(clients.at(-1)?.sent).toEqual([{ type: 'client.unavailable' }]);
      expect(registry.sessionCount(instanceId)).toBe(16);
    });

    it('should relay the offer and the candidates between browser and host', async () => {
      const { host, client, sessionId } = await connectClient();

      client.receive({ type: 'client.offer', sdp: 'offer' });
      client.receive({ type: 'client.candidate', candidate: 'c1', mid: '0' });
      host.receive({ type: 'host.answer', sessionId, sdp: 'answer' });
      host.receive({ type: 'host.candidate', sessionId, candidate: 'c2', mid: '0' });

      expect(host.sent.slice(1)).toEqual([
        { type: 'session.offer', sessionId, sdp: 'offer', iceServers: STUN },
        { type: 'session.candidate', sessionId, candidate: 'c1', mid: '0' },
      ]);
      expect(client.sent.slice(1)).toEqual([
        { type: 'session.answer', sdp: 'answer' },
        { type: 'session.candidate', candidate: 'c2', mid: '0' },
      ]);
    });

    it('should end the session the host gives up', async () => {
      const { host, client, sessionId } = await connectClient();
      host.receive({ type: 'host.close', sessionId });

      expect(client.sent.at(-1)).toEqual({ type: 'session.closed' });
      expect(client.closed).toBeDefined();
      expect(registry.session(sessionId)).toBeUndefined();
    });

    it('should tell the host when the browser leaves', async () => {
      const { host, client, sessionId } = await connectClient();
      client.emitClose();

      expect(host.sent.at(-1)).toEqual({ type: 'session.closed', sessionId });
      expect(registry.session(sessionId)).toBeUndefined();
    });

    it('should ignore signals of a host about sessions of another instance', async () => {
      const { client, sessionId } = await connectClient();
      const other = transport.connectHost();
      const otherSecret = 'other-secret';
      other.receive({ type: 'host.register', instanceId: await deriveInstanceId(otherSecret), secret: otherSecret, protocolVersion: 3 });
      await flush();
      other.receive({ type: 'host.answer', sessionId, sdp: 'answer' });
      other.receive({ type: 'host.answer', sessionId: '6f1c0f0e-1f53-4c1e-9d55-6bb1f6c2a1a7', sdp: 'answer' });

      expect(client.sent).toHaveLength(1);
    });

    it.each([
      ['an invalid signal', [{ type: 'nope' }], 'invalid signal'],
      ['an offer before connecting', [{ type: 'client.offer', sdp: 'x' }], 'unexpected client.offer'],
      ['a candidate before the offer', [{ type: 'client.connect', instanceId: 'ID' }, { type: 'client.candidate', candidate: 'c', mid: '0' }], 'unexpected client.candidate'],
      ['a second offer', [{ type: 'client.connect', instanceId: 'ID' }, { type: 'client.offer', sdp: 'x' }, { type: 'client.offer', sdp: 'x' }], 'unexpected client.offer'],
      ['connecting twice', [{ type: 'client.connect', instanceId: 'ID' }, { type: 'client.connect', instanceId: 'ID' }], 'connected twice'],
    ])('should be closed for %s', async (_name, signals, reason) => {
      await registerHost();
      const client = transport.connectClient();
      signals.forEach(signal => client.receive(JSON.parse(JSON.stringify(signal).replace('"ID"', `"${instanceId}"`))));

      expect(client.closed).toEqual({ code: 1008, reason });
    });

    it('should be closed for a signal after its host went offline', async () => {
      const { host, client } = await connectClient();
      host.emitClose();
      client.closed = undefined;
      client.receive({ type: 'client.offer', sdp: 'x' });

      expect(client.closed).toEqual({ code: 1008, reason: 'unexpected client.offer' });
    });

    it('should be closed when it does not connect in time and after the negotiation time', async () => {
      const silent = transport.connectClient();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(silent.closed).toEqual({ code: 1008, reason: 'no connect' });

      const { client } = await connectClient();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.closed).toEqual({ code: undefined, reason: undefined });
    });

    it('should leave nothing behind when it closes without a session', () => {
      transport.connectClient().emitClose();

      expect(registry.sessionCount(instanceId)).toBe(0);
    });
  });
});
