import { z } from 'zod';

import { FINGERPRINT_PATTERN } from './fingerprint.js';


/** Where a host keeps its signaling socket open on the signaling server. */
export const SIGNALING_HOST_PATH = '/signal/host';
/** Where a browser opens its signaling socket while it negotiates a connection to a host. */
export const SIGNALING_CLIENT_PATH = '/signal/client';
/** Payload limit of a signaling socket; an SDP of a data channel is a few KiB. */
export const MAX_SIGNAL_BYTES = 64 * 1024;
/** The one data channel a browser opens to a host. */
export const DATA_CHANNEL_LABEL = 'arc';
/** Candidates a browser may send in one session; a few per network interface is the norm. */
export const MAX_CANDIDATES_PER_SESSION = 32;

/** Close codes of a host signaling socket that tell the host to stop reconnecting. */
export const SIGNALING_CLOSE_CODES = {
  /** The registration does not prove holding the certificate of the instance. */
  invalid: 4400,
  /** The signaling server serves a list of instances that leaves this one out. */
  forbidden: 4403,
  /** Another process registered the same instance. */
  replaced: 4409,
} as const;

/** What a host signs with the key of its certificate to register: the nonce of the server's `host.challenge`. */
export function registrationPayload(nonce: string): string {
  return `arc-host-register:${nonce}`;
}

export const instanceIdSchema = z.string().regex(/^[0-9a-f]{20}$/);
const fingerprintSchema = z.string().regex(FINGERPRINT_PATTERN);
/** A base64url HMAC-SHA256 from `sessionProof`. */
const proofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sourceSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Bytes of the `source` of a `session.request`: a keyed hash of the browser's address, truncated. */
export const SOURCE_BYTES = 16;

export const iceServerSchema = z.object({
  urls: z.array(z.string().min(1).max(500)).min(1).max(10),
  username: z.string().max(500).optional(),
  credential: z.string().max(500).optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

const sessionIdSchema = z.uuid();
const sdpSchema = z.string().min(1).max(32 * 1024);
const candidateFields = { candidate: z.string().max(1000), mid: z.string().max(100) };

/** What a host sends to the signaling server. */
export const hostSignalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host.register'),
    instanceId: instanceIdSchema,
    /** The DER certificate, base64. */
    certificate: z.string().min(1).max(4096),
    /** `registrationPayload(nonce)` signed with the certificate's key, base64url (IEEE P1363 for ECDSA). */
    signature: z.string().min(1).max(1024),
    protocolVersion: z.number().int(),
  }),
  /** The proof of the session's request holds: the browser gets the ICE servers and may offer. */
  z.object({ type: z.literal('host.accept'), sessionId: sessionIdSchema }),
  /** The proof of the session's request does not hold: the browser's access token is wrong. */
  z.object({ type: z.literal('host.reject'), sessionId: sessionIdSchema }),
  z.object({ type: z.literal('host.answer'), sessionId: sessionIdSchema, sdp: sdpSchema }),
  z.object({ type: z.literal('host.candidate'), sessionId: sessionIdSchema, ...candidateFields }),
  /** The host gives up a session it will not or can no longer negotiate. */
  z.object({ type: z.literal('host.close'), sessionId: sessionIdSchema }),
]);
export type HostSignal = z.infer<typeof hostSignalSchema>;

/** What the signaling server sends to a host. */
export const toHostSignalSchema = z.discriminatedUnion('type', [
  /** The first signal of every host socket; the host answers with `host.register`. */
  z.object({ type: z.literal('host.challenge'), nonce: z.string().min(16).max(100) }),
  z.object({ type: z.literal('host.registered') }),
  /**
   * A browser asks for a session, proving its access token for the certificate it will offer. `source` stands for the
   * browser's address without revealing it, so the host backs off the addresses that send wrong proofs.
   */
  z.object({
    type: z.literal('session.request'),
    sessionId: sessionIdSchema,
    source: sourceSchema,
    fingerprint: fingerprintSchema,
    proof: proofSchema,
  }),
  z.object({
    type: z.literal('session.offer'),
    sessionId: sessionIdSchema,
    sdp: sdpSchema,
    iceServers: z.array(iceServerSchema),
  }),
  z.object({ type: z.literal('session.candidate'), sessionId: sessionIdSchema, ...candidateFields }),
  z.object({ type: z.literal('session.closed'), sessionId: sessionIdSchema }),
]);
export type ToHostSignal = z.infer<typeof toHostSignalSchema>;

/** What a browser sends to the signaling server. */
export const clientSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client.connect'), instanceId: instanceIdSchema, fingerprint: fingerprintSchema, proof: proofSchema }),
  /** Only after `client.accepted`, announcing the certificate of `client.connect`. */
  z.object({ type: z.literal('client.offer'), sdp: sdpSchema }),
  z.object({ type: z.literal('client.candidate'), ...candidateFields }),
]);
export type ClientSignal = z.infer<typeof clientSignalSchema>;

/** What the signaling server sends to a browser. */
export const toClientSignalSchema = z.discriminatedUnion('type', [
  /** The host accepted the proof of `client.connect`. */
  z.object({ type: z.literal('client.accepted'), iceServers: z.array(iceServerSchema), protocolVersion: z.number().int() }),
  /** No host holds the instance right now, or it takes no more sessions for now. */
  z.object({ type: z.literal('client.unavailable') }),
  /** The host refused the proof of `client.connect`: the access token is wrong. */
  z.object({ type: z.literal('client.rejected') }),
  z.object({ type: z.literal('session.answer'), sdp: sdpSchema }),
  z.object({ type: z.literal('session.candidate'), ...candidateFields }),
  z.object({ type: z.literal('session.closed') }),
]);
export type ToClientSignal = z.infer<typeof toClientSignalSchema>;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, data: unknown): Parsed<T> {
  const result = schema.safeParse(data);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: result.error.message };
}

export function parseHostSignal(data: unknown): Parsed<HostSignal> {
  return parseWith(hostSignalSchema, data);
}

export function parseToHostSignal(data: unknown): Parsed<ToHostSignal> {
  return parseWith(toHostSignalSchema, data);
}

export function parseClientSignal(data: unknown): Parsed<ClientSignal> {
  return parseWith(clientSignalSchema, data);
}

export function parseToClientSignal(data: unknown): Parsed<ToClientSignal> {
  return parseWith(toClientSignalSchema, data);
}
