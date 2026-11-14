import { parseClientSignal, parseHostSignal, parseToClientSignal, parseToHostSignal } from './signaling.js';


const instanceId = '0123456789abcdef0123';
const sessionId = '6f1c0f0e-1f53-4c1e-9d55-6bb1f6c2a1a7';
const iceServers = [{ urls: ['stun:stun.example.com:3478'] }, { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' }];

describe('signaling', () => {
  it.each([
    { type: 'host.register', instanceId, secret: 's', protocolVersion: 1 },
    { type: 'host.answer', sessionId, sdp: 'v=0' },
    { type: 'host.candidate', sessionId, candidate: 'candidate:1', mid: '0' },
    { type: 'host.close', sessionId },
  ])('should accept the host signal $type', (signal) => {
    expect(parseHostSignal(signal)).toEqual({ ok: true, value: signal });
  });

  it.each([
    { type: 'host.registered' },
    { type: 'session.offer', sessionId, sdp: 'v=0', iceServers },
    { type: 'session.candidate', sessionId, candidate: 'candidate:1', mid: '0' },
    { type: 'session.closed', sessionId },
  ])('should accept the signal $type sent to a host', (signal) => {
    expect(parseToHostSignal(signal)).toEqual({ ok: true, value: signal });
  });

  it.each([
    { type: 'client.connect', instanceId },
    { type: 'client.offer', sdp: 'v=0' },
    { type: 'client.candidate', candidate: 'candidate:1', mid: '0' },
  ])('should accept the client signal $type', (signal) => {
    expect(parseClientSignal(signal)).toEqual({ ok: true, value: signal });
  });

  it.each([
    { type: 'client.accepted', iceServers, protocolVersion: 1 },
    { type: 'client.unavailable' },
    { type: 'session.answer', sdp: 'v=0' },
    { type: 'session.candidate', candidate: 'candidate:1', mid: '0' },
    { type: 'session.closed' },
  ])('should accept the signal $type sent to a client', (signal) => {
    expect(parseToClientSignal(signal)).toEqual({ ok: true, value: signal });
  });

  it.each([
    ['an instance id that is not hex', parseHostSignal, { type: 'host.register', instanceId: 'ZZ', secret: 's', protocolVersion: 1 }],
    ['a session id that is not a uuid', parseHostSignal, { type: 'host.close', sessionId: '1' }],
    ['an unknown type', parseClientSignal, { type: 'client.other' }],
    ['an empty SDP', parseToClientSignal, { type: 'session.answer', sdp: '' }],
    ['an ICE server without urls', parseToHostSignal, { type: 'session.offer', sessionId, sdp: 'v=0', iceServers: [{ urls: [] }] }],
  ])('should refuse %s', (_name, parse, signal) => {
    expect(parse(signal)).toMatchObject({ ok: false });
  });
});
