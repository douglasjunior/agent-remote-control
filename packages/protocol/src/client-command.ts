import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from './limits.js';


export const clientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('conversation.list') }),
  z.object({ type: z.literal('conversation.create'), requestId: z.string() }),
  z.object({ type: z.literal('conversation.history'), conversationId: z.string() }),
  z.object({
    type: z.literal('message.send'),
    conversationId: z.string(),
    text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  }),
  z.object({ type: z.literal('turn.cancel'), conversationId: z.string() }),
  z.object({
    type: z.literal('config.open'),
    conversationId: z.string(),
    menu: z.enum(['agent', 'model', 'profiles']),
  }),
  z.object({ type: z.literal('config.cancel'), conversationId: z.string() }),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

export function parseClientCommand(
  data: unknown,
): { ok: true; value: ClientCommand } | { ok: false; error: string } {
  const result = clientCommandSchema.safeParse(data);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.message };
}
