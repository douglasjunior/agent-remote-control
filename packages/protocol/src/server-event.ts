import { z } from 'zod';

import { agentAuthInfoSchema, agentLoginEventSchema } from './agent-auth.js';
import { agentOptionSchema } from './agent-option.js';
import { roleProfileSchema } from './agent-profile.js';
import { agentQuotaReportSchema } from './agent-quota.js';
import { attachmentSchema } from './attachment.js';
import { conversationEntrySchema } from './conversation-entry.js';
import { conversationStateSchema, conversationSummarySchema } from './conversation.js';


export const interruptedWorkSchema = z.object({
  id: z.string(),
  role: z.string(),
  roleName: z.string(),
  projectName: z.string().nullable(),
  summary: z.string(),
});

export type InterruptedWork = z.infer<typeof interruptedWorkSchema>;

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
    /** The response being written when the history was read; absent when there is none. */
    draft: z.string().optional(),
    /** The agents a server restart stopped, which the user can set going again. */
    interrupted: z.array(interruptedWorkSchema).optional(),
  }),
  z.object({
    type: z.literal('conversation.entry'),
    conversationId: z.string(),
    entry: conversationEntrySchema,
  }),
  z.object({
    type: z.literal('conversation.draft'),
    conversationId: z.string(),
    /** The user-facing text of the response being written, whole at every event; empty when it is discarded. */
    text: z.string(),
  }),
  z.object({
    type: z.literal('conversation.interrupted'),
    conversationId: z.string(),
    interrupted: z.array(interruptedWorkSchema),
  }),
  z.object({
    type: z.literal('conversation.state'),
    conversationId: z.string(),
    state: conversationStateSchema,
  }),
  z.object({ type: z.literal('prompts.list'), requestId: z.string(), prompts: z.array(z.string()) }),
  z.object({
    type: z.literal('files.results'),
    requestId: z.string(),
    items: z.array(z.object({
      path: z.string(),
      kind: z.enum(['file', 'directory']),
      matches: z.array(z.number().int().min(0)),
    })),
    walking: z.boolean(),
  }),
  z.object({ type: z.literal('upload.ready'), uploadId: z.string() }),
  z.object({ type: z.literal('upload.ack'), uploadId: z.string(), index: z.number().int().min(0) }),
  z.object({ type: z.literal('upload.done'), uploadId: z.string(), attachment: attachmentSchema }),
  z.object({ type: z.literal('upload.failed'), uploadId: z.string(), reason: z.string() }),
  z.object({ type: z.literal('agents.list'), agents: z.array(agentOptionSchema) }),
  z.object({
    type: z.literal('quota.report'),
    reports: z.array(agentQuotaReportSchema).readonly(),
    fetchedAt: z.string(),
  }),
  z.object({ type: z.literal('quota.failed') }),
  z.object({
    type: z.literal('auth.status'),
    agents: z.array(agentAuthInfoSchema).readonly(),
    fetchedAt: z.string(),
  }),
  z.object({ type: z.literal('auth.status.failed') }),
  z.object({ type: z.literal('auth.login'), agentId: z.string(), event: agentLoginEventSchema }),
  z.object({ type: z.literal('models.list'), agentId: z.string(), models: z.array(agentOptionSchema) }),
  z.object({
    type: z.literal('efforts.list'),
    agentId: z.string(),
    modelId: z.string(),
    efforts: z.array(agentOptionSchema),
  }),
  z.object({
    type: z.literal('profiles'),
    conversationId: z.string(),
    configured: z.boolean(),
    profiles: z.array(roleProfileSchema),
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
