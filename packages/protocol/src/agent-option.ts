import { z } from 'zod';


export const agentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});
export type AgentOption = z.infer<typeof agentOptionSchema>;
