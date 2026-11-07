import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from './limits.js';


export const agentAuthInfoSchema = z.object({
  agentId: z.string(),
  displayName: z.string(),
  status: z.enum(['authenticated', 'unauthenticated', 'unknown']),
  detail: z.string().optional(),
});
export type AgentAuthInfo = z.infer<typeof agentAuthInfoSchema>;

export const agentLoginEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string(), code: z.string().optional() }),
  z.object({ kind: z.literal('prompt'), hint: z.string() }),
  z.object({ kind: z.literal('completed') }),
  z.object({ kind: z.literal('failed'), reason: z.string() }),
  z.object({ kind: z.literal('cancelled') }),
]);
export type AgentLoginEvent = z.infer<typeof agentLoginEventSchema>;

/** The text a user pastes from the browser after a login. */
export const agentLoginInputSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);
