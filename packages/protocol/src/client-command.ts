import { z } from 'zod';

import { attachmentSchema } from './attachment.js';
import { MAX_ATTACHMENT_NAME_LENGTH, MAX_ATTACHMENTS, MAX_MENTION_QUERY_LENGTH, MAX_MESSAGE_LENGTH, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './limits.js';


export const clientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('conversation.list') }),
  z.object({ type: z.literal('conversation.create'), requestId: z.string() }),
  z.object({ type: z.literal('conversation.history'), conversationId: z.string() }),
  z.object({
    type: z.literal('message.send'),
    conversationId: z.string(),
    text: z.string().trim().max(MAX_MESSAGE_LENGTH),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  }).refine(command => command.text.length > 0 || (command.attachments?.length ?? 0) > 0, {
    message: 'A message needs text or an attachment',
  }),
  z.object({
    type: z.literal('upload.start'),
    uploadId: z.string(),
    conversationId: z.string(),
    name: z.string().min(1).max(MAX_ATTACHMENT_NAME_LENGTH),
    size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  }),
  z.object({
    type: z.literal('upload.chunk'),
    uploadId: z.string(),
    index: z.number().int().min(0),
    dataBase64: z.string().max(Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4),
  }),
  z.object({ type: z.literal('upload.finish'), uploadId: z.string() }),
  z.object({ type: z.literal('upload.abort'), uploadId: z.string() }),
  z.object({ type: z.literal('turn.cancel'), conversationId: z.string() }),
  z.object({ type: z.literal('prompts.history'), requestId: z.string() }),
  z.object({ type: z.literal('files.search'), requestId: z.string(), query: z.string().max(MAX_MENTION_QUERY_LENGTH) }),
  z.object({ type: z.literal('files.close'), requestId: z.string() }),
  z.object({ type: z.literal('agents.list') }),
  z.object({ type: z.literal('models.list'), agentId: z.string() }),
  z.object({ type: z.literal('efforts.list'), agentId: z.string(), modelId: z.string() }),
  z.object({ type: z.literal('profiles.get'), conversationId: z.string() }),
  z.object({
    type: z.literal('profiles.set'),
    conversationId: z.string(),
    roles: z.array(z.string()).min(1).optional(),
    agentId: z.string(),
    modelId: z.string().optional(),
    effortId: z.string().optional(),
  }),
  z.object({
    type: z.literal('question.answer'),
    conversationId: z.string(),
    answer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('option'), optionIndex: z.number().int().min(1) }),
      z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }),
    ]),
  }),
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
