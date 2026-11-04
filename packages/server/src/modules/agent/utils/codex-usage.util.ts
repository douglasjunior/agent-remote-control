import type {
  AgentQuota,
  AgentQuotaBucket,
} from '../ports/agent.port.js';


type RawWindow = {
  readonly usedPercent?: unknown;
  readonly windowDurationMins?: unknown;
  readonly resetsAt?: unknown;
};

const WINDOW_KEYS = ['primary', 'secondary'] as const;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function formatWindow(minutes: unknown): string | undefined {
  if (typeof minutes !== 'number' || !(minutes > 0)) return undefined;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function parseWindow(key: string, raw: unknown): AgentQuotaBucket | undefined {
  const window = asObject(raw) as RawWindow | undefined;
  if (!window || typeof window.usedPercent !== 'number') return undefined;
  const label = formatWindow(window.windowDurationMins);
  return {
    id: key,
    name: label ? `${label} limit` : `${key} limit`,
    window: label ?? key,
    remainingFraction: Math.min(1, Math.max(0, 1 - window.usedPercent / 100)),
    resetTime:
      typeof window.resetsAt === 'number'
        ? new Date(window.resetsAt * 1000).toISOString()
        : undefined,
  };
}

/**
 * Converts the `result` of the `account/rateLimits/read` request of
 * `codex app-server` (`{ rateLimits: { primary, secondary } }`). Returns
 * `undefined` when the account reports no rate-limit window, which is the case
 * for API-key logins.
 */
export function parseCodexRateLimits(result: unknown): AgentQuota | undefined {
  const rateLimits = asObject(asObject(result)?.rateLimits);
  if (!rateLimits) return undefined;
  const buckets = WINDOW_KEYS
    .map(key => parseWindow(key, rateLimits[key]))
    .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
  return buckets.length > 0 ? { groups: [{ name: 'Codex', buckets }] } : undefined;
}
