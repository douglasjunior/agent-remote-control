import { z } from 'zod';

import { agentLoginInputSchema } from './agent-auth.js';
import { artifactCommentSchema, artifactCreateInputSchema, artifactUpdateInputSchema } from './artifact.js';
import { attachmentSchema } from './attachment.js';
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_MENTION_QUERY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
} from './limits.js';
import { squadDescriptionSchema, squadNameSchema, squadProfileInputSchema } from './squad.js';


export const clientCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  /** Sent every few seconds by the web app once authenticated; a connection that stops answering `pong` is dropped. */
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('conversation.list') }),
  z.object({ type: z.literal('conversation.create'), requestId: z.string() }),
  z.object({ type: z.literal('conversation.history'), conversationId: z.string() }),
  /** Asks for the entries before `before`, the position of the oldest entry the client holds. */
  z.object({ type: z.literal('conversation.entries'), conversationId: z.string(), before: z.number().int().min(1) }),
  z.object({
    type: z.literal('conversation.rename'),
    conversationId: z.string(),
    title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE_LENGTH),
  }),
  /** Archives the conversation, or brings it back with `archived: false`; the answer is a `conversation.updated` to every connection. */
  z.object({ type: z.literal('conversation.archive'), conversationId: z.string(), archived: z.boolean() }),
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
  z.object({ type: z.literal('work.resume'), conversationId: z.string(), workId: z.string() }),
  /** Retries the failed turn of the conversation now, without waiting for the countdown. */
  z.object({ type: z.literal('retry.now'), conversationId: z.string() }),
  /** Ends the retries of the failed turn, so its error stands. */
  z.object({ type: z.literal('retry.stop'), conversationId: z.string() }),
  z.object({ type: z.literal('prompts.history'), requestId: z.string() }),
  z.object({ type: z.literal('files.search'), requestId: z.string(), query: z.string().max(MAX_MENTION_QUERY_LENGTH) }),
  z.object({ type: z.literal('files.close'), requestId: z.string() }),
  z.object({ type: z.literal('agents.list') }),
  z.object({ type: z.literal('projects.list') }),
  z.object({ type: z.literal('skills.list') }),
  z.object({ type: z.literal('skill.get'), name: z.string().min(1) }),
  z.object({ type: z.literal('skill.delete'), requestId: z.string(), name: z.string().min(1) }),
  z.object({ type: z.literal('artifacts.list'), conversationId: z.string() }),
  z.object({ type: z.literal('artifact.get'), conversationId: z.string(), id: z.string() }),
  z.object({ type: z.literal('artifact.create'), conversationId: z.string(), requestId: z.string(), artifact: artifactCreateInputSchema }),
  z.object({
    type: z.literal('artifact.update'),
    conversationId: z.string(),
    requestId: z.string(),
    id: z.string(),
    changes: artifactUpdateInputSchema,
  }),
  z.object({ type: z.literal('artifact.comment'), conversationId: z.string(), requestId: z.string(), id: z.string(), text: artifactCommentSchema }),
  z.object({ type: z.literal('artifact.delete'), conversationId: z.string(), requestId: z.string(), id: z.string() }),
  z.object({ type: z.literal('settings.get') }),
  /** Saves the values, by setting key (`USER_LANGUAGE` included), whole or not at all; the server checks each one. */
  z.object({
    type: z.literal('settings.set'),
    requestId: z.string(),
    changes: z.record(z.string().max(64), z.union([z.string().max(4096), z.number(), z.boolean()])),
  }),
  /** Removes the saved values, so the environment variable or the default applies again. */
  z.object({ type: z.literal('settings.reset'), requestId: z.string(), keys: z.array(z.string().max(64)).min(1) }),
  /** Tests a bot token typed in the form before it is saved (the saved one when absent), and the server id given. */
  z.object({ type: z.literal('settings.discord.test'), token: z.string().max(4096).optional(), guildId: z.string().max(64).optional() }),
  z.object({ type: z.literal('quota.get'), refresh: z.boolean().optional() }),
  z.object({ type: z.literal('auth.status'), refresh: z.boolean().optional() }),
  z.object({ type: z.literal('auth.login'), agentId: z.string() }),
  z.object({ type: z.literal('auth.input'), agentId: z.string(), text: agentLoginInputSchema }),
  z.object({ type: z.literal('auth.cancel'), agentId: z.string() }),
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
  z.object({ type: z.literal('squads.list') }),
  /** Creates a squad, or replaces the one with `id`; the answer is a `squads` to every connection, or an `error`. */
  z.object({
    type: z.literal('squads.save'),
    id: z.string().optional(),
    name: squadNameSchema,
    description: squadDescriptionSchema.optional(),
    isDefault: z.boolean(),
    profiles: z.record(z.string(), squadProfileInputSchema),
  }),
  z.object({ type: z.literal('squads.delete'), id: z.string() }),
  /** Copies the squad's profiles into the conversation; the answer is a `profiles` to every connection, or an `error`. */
  z.object({ type: z.literal('squads.apply'), conversationId: z.string(), squadId: z.string() }),
  z.object({
    type: z.literal('question.answer'),
    conversationId: z.string(),
    answer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('option'), optionIndex: z.number().int().min(1) }),
      z.object({
        kind: z.literal('text'),
        text: z.string().trim().max(MAX_MESSAGE_LENGTH),
        attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
      }).refine(answer => answer.text.length > 0 || (answer.attachments?.length ?? 0) > 0, {
        message: 'An answer needs text or an attachment',
      }),
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
