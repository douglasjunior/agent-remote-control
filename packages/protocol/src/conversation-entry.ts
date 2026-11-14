import { z } from 'zod';

import { attachmentSchema } from './attachment.js';


const entryBase = { id: z.string(), at: z.iso.datetime() };

const agentInfoSchema = z.object({
  roleName: z.string(),
  agentName: z.string(),
  modelName: z.string().optional(),
  effortName: z.string().optional(),
});

export const conversationEntrySchema = z.discriminatedUnion('type', [
  z.object({
    ...entryBase,
    type: z.literal('user_message'),
    text: z.string(),
    attachments: z.array(attachmentSchema).optional(),
  }),
  z.object({
    ...entryBase,
    type: z.literal('thought'),
    text: z.string(),
    removed: z.boolean().optional(),
    /** The role of the agent that produced the step. */
    role: z.string(),
  }),
  z.object({
    ...entryBase,
    type: z.literal('tool'),
    title: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    result: z.string().optional(),
    details: z.string().optional(),
    role: z.string(),
  }),
  /** A skill an agent read or wrote. */
  z.object({
    ...entryBase,
    type: z.literal('skill'),
    role: z.string(),
    action: z.enum(['read', 'write']),
    names: z.array(z.string()),
    status: z.enum(['completed', 'failed']),
    /** Whether a write created the skill rather than replacing it. */
    created: z.boolean().optional(),
    error: z.string().optional(),
  }),
  z.object({
    ...entryBase,
    type: z.literal('delegation'),
    /** Pairs the `started` entry with the entry that closes the same delegation. */
    delegationId: z.string(),
    phase: z.enum(['started', 'finished', 'failed', 'cancelled']),
    round: z.number().int(),
    role: z.string(),
    roleName: z.string(),
    projectName: z.string().optional(),
    /** The artifact the agent was delegated, which it holds until the delegation ends. */
    artifactId: z.string().optional(),
    /** One plain-language sentence from the CEO telling the user what the agent was asked to do. */
    summary: z.string(),
    /** What the CEO wrote for the agent. A stored history is validated whole, so an entry written without it reads as empty rather than losing the conversation. */
    prompt: z.string().default(''),
    response: z.string().optional(),
    /** Why the agent stopped; present when `phase` is `failed`. */
    errorMessage: z.string().optional(),
    agentInfo: agentInfoSchema.optional(),
    durationMs: z.number().optional(),
  }),
  z.object({ ...entryBase, type: z.literal('interim'), text: z.string() }),
  z.object({
    ...entryBase,
    type: z.literal('question'),
    askerRole: z.string(),
    askerRoleName: z.string(),
    projectName: z.string().optional(),
    text: z.string(),
    rationale: z.string().optional(),
    options: z.array(z.string()),
    /** 1-based option the agent recommends, assumed when the user does not answer in time. */
    recommendedIndex: z.number().int().optional(),
    /** `expiresAt` is epoch milliseconds; absent when the timeout is disabled. */
    timeout: z.object({ expiresAt: z.number(), durationMs: z.number() }).optional(),
    number: z.number().int(),
    total: z.number().int(),
    /** Whether the question can no longer be answered; the server closes it in place. */
    closed: z.boolean(),
    message: z.string().optional(),
  }),
  z.object({
    ...entryBase,
    type: z.literal('notice'),
    level: z.enum(['info', 'warning', 'error']),
    text: z.string(),
  }),
  z.object({
    ...entryBase,
    type: z.literal('agent_response'),
    status: z.enum(['completed', 'cancelled', 'failed', 'steered']),
    response: z.string(),
    errorMessage: z.string().optional(),
    agentInfo: agentInfoSchema.optional(),
  }),
]);
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;
