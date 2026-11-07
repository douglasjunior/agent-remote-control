import { z } from 'zod';


const namedValueSchema = z.object({ id: z.string(), name: z.string() });

/** The agent, model and effort a role uses in a conversation; absent when the conversation has no settings. */
export const roleProfileSchema = z.object({
  role: z.string(),
  roleName: z.string(),
  agent: namedValueSchema.extend({ available: z.boolean() }).optional(),
  model: namedValueSchema.optional(),
  effort: namedValueSchema.optional(),
});
export type RoleProfile = z.infer<typeof roleProfileSchema>;
