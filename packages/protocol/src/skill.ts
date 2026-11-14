import { z } from 'zod';


/** A skill as the user sees it: the roles that read it, and whether it ships with the server or is the user's own. */
export const skillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  roles: z.array(z.string()),
  builtIn: z.boolean(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const skillDetailSchema = skillSummarySchema.extend({
  content: z.string(),
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;
