import { z } from 'zod';


/** Where a host keeps its signaling socket open on the signaling server. */
export const SIGNALING_HOST_PATH = '/signal/host';
/** Where a browser opens its signaling socket while it negotiates a connection to a host. */
export const SIGNALING_CLIENT_PATH = '/signal/client';
/** Payload limit of a signaling socket; an SDP of a data channel is a few KiB. */
export const MAX_SIGNAL_BYTES = 64 * 1024;
/** The one data channel a browser opens to a host. */
export const DATA_CHANNEL_LABEL = 'arc';

/** Close codes of a host signaling socket that tell the host to stop reconnecting. */
export const SIGNALING_CLOSE_CODES = {
  /** The secret does not derive the instance id it registers. */
  invalid: 4400,
  /** Another process registered the same instance. */
  replaced: 4409,
} as const;

export const instanceIdSchema = z.string().regex(/^[0-9a-f]{20}$/);

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
    secret: z.string().min(1).max(200),
    protocolVersion: z.number().int(),
  }),
  z.object({ type: z.literal('host.answer'), sessionId: sessionIdSchema, sdp: sdpSchema }),
  z.object({ type: z.literal('host.candidate'), sessionId: sessionIdSchema, ...candidateFields }),
  /** The host gives up a session it will not or can no longer negotiate. */
  z.object({ type: z.literal('host.close'), sessionId: sessionIdSchema }),
]);
export type HostSignal = z.infer<typeof hostSignalSchema>;

/** What the signaling server sends to a host. */
export const toHostSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host.registered') }),
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
  z.object({ type: z.literal('client.connect'), instanceId: instanceIdSchema }),
  z.object({ type: z.literal('client.offer'), sdp: sdpSchema }),
  z.object({ type: z.literal('client.candidate'), ...candidateFields }),
]);
export type ClientSignal = z.infer<typeof clientSignalSchema>;

/** What the signaling server sends to a browser. */
export const toClientSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client.accepted'), iceServers: z.array(iceServerSchema), protocolVersion: z.number().int() }),
  /** No host holds the instance right now. */
  z.object({ type: z.literal('client.unavailable') }),
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
