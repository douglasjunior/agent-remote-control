import { z } from 'zod';


export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** When the user archived the conversation; absent while it is active. An archived conversation still works. */
  archivedAt: z.iso.datetime().optional(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationStateSchema = z.enum(['idle', 'queued', 'running']);
export type ConversationState = z.infer<typeof conversationStateSchema>;
