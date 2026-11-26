import { z } from 'zod';

import { roleProfileSchema } from './agent-profile.js';
import { MAX_SQUAD_DESCRIPTION_LENGTH, MAX_SQUAD_NAME_LENGTH } from './limits.js';


/** The squad a conversation's profiles were last copied from. */
export const appliedSquadSchema = z.object({ id: z.string(), name: z.string() });
export type AppliedSquad = z.infer<typeof appliedSquadSchema>;

/** A saved set of profiles, applied to a conversation in one go; `profiles` holds only the roles it sets. */
export const squadSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Applied to every conversation that starts without settings. */
  isDefault: z.boolean(),
  profiles: z.array(roleProfileSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Squad = z.infer<typeof squadSchema>;

export const squadProfileInputSchema = z.object({
  agentId: z.string(),
  modelId: z.string().optional(),
  effortId: z.string().optional(),
});
export type SquadProfileInput = z.infer<typeof squadProfileInputSchema>;

export const squadNameSchema = z.string().trim().min(1, 'A squad needs a name').max(MAX_SQUAD_NAME_LENGTH);
export const squadDescriptionSchema = z.string().trim().max(MAX_SQUAD_DESCRIPTION_LENGTH);
