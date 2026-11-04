import { z } from 'zod';

import { conversationEntrySchema } from './conversation-entry.js';
import { conversationStateSchema, conversationSummarySchema } from './conversation.js';


export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth.ok') }),
  z.object({ type: z.literal('auth.failed') }),
  z.object({
    type: z.literal('conversation.list'),
    conversations: z.array(conversationSummarySchema),
  }),
  z.object({
    type: z.literal('conversation.created'),
    requestId: z.string(),
    conversation: conversationSummarySchema,
  }),
  z.object({ type: z.literal('conversation.updated'), conversation: conversationSummarySchema }),
  z.object({
    type: z.literal('conversation.history'),
    conversationId: z.string(),
    entries: z.array(conversationEntrySchema),
    state: conversationStateSchema,
  }),
  z.object({
    type: z.literal('conversation.entry'),
    conversationId: z.string(),
    entry: conversationEntrySchema,
  }),
  z.object({
    type: z.literal('conversation.state'),
    conversationId: z.string(),
    state: conversationStateSchema,
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    conversationId: z.string().optional(),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseServerEvent(
  data: unknown,
): { ok: true; value: ServerEvent } | { ok: false; error: string } {
  const result = serverEventSchema.safeParse(data);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.message };
}
