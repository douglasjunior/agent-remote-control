import { z } from 'zod';


export const agentQuotaBucketSchema = z.object({
  id: z.string(),
  name: z.string(),
  window: z.string(),
  /** Reported by each CLI and left unbounded here, because one odd value must not drop the whole event; clients clamp it. */
  remainingFraction: z.number(),
  resetTime: z.string().optional(),
  description: z.string().optional(),
});
export type AgentQuotaBucket = z.infer<typeof agentQuotaBucketSchema>;

export const agentQuotaGroupSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  buckets: z.array(agentQuotaBucketSchema).readonly(),
});

export const agentQuotaReportSchema = z.object({
  agent: z.object({ id: z.string(), name: z.string() }),
  status: z.enum(['ok', 'unsupported', 'failed']),
  quota: z.object({
    description: z.string().optional(),
    groups: z.array(agentQuotaGroupSchema).readonly(),
  }).optional(),
});
export type AgentQuotaReport = z.infer<typeof agentQuotaReportSchema>;
