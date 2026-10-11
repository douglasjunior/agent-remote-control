import type {
  AgentQuota,
  AgentQuotaBucket,
} from '../ports/agent.port.js';


type RawSnapshot = {
  readonly quota_id?: unknown;
  readonly percent_remaining?: unknown;
  readonly remaining?: unknown;
  readonly entitlement?: unknown;
  readonly unlimited?: unknown;
};

const QUOTA_NAMES: Readonly<Record<string, string>> = {
  premium_interactions: 'Premium Requests Remaining',
};

const humanize = (quotaId: string): string =>
  `${quotaId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')} Remaining`;

const parseSnapshot = (
  key: string,
  raw: RawSnapshot,
  resetTime: string | undefined,
): AgentQuotaBucket | undefined => {
  if (raw.unlimited === true || typeof raw.percent_remaining !== 'number') {
    return undefined;
  }
  const id = typeof raw.quota_id === 'string' ? raw.quota_id : key;
  const hasCounts =
    typeof raw.remaining === 'number' && typeof raw.entitlement === 'number';
  return {
    id,
    name: QUOTA_NAMES[id] ?? humanize(id),
    window: 'monthly',
    remainingFraction: raw.percent_remaining / 100,
    resetTime,
    description: hasCounts
      ? `${String(raw.remaining)} of ${String(raw.entitlement)} remaining`
      : undefined,
  };
};

/**
 * Parses the output of `gh api /copilot_internal/user`. Unlimited snapshots are
 * skipped; returns `undefined` when the payload has no `quota_snapshots`.
 */
export function parseCopilotUserOutput(output: string): AgentQuota | undefined {
  let parsed: {
    copilot_plan?: unknown;
    quota_reset_date_utc?: unknown;
    quota_snapshots?: unknown;
  };
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  const snapshots = parsed?.quota_snapshots;
  if (!snapshots || typeof snapshots !== 'object') {
    return undefined;
  }
  const resetTime =
    typeof parsed.quota_reset_date_utc === 'string'
      ? parsed.quota_reset_date_utc
      : undefined;
  const buckets = Object.entries(snapshots as Record<string, RawSnapshot>)
    .map(([key, raw]) => parseSnapshot(key, raw ?? {}, resetTime))
    .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
  const plan = typeof parsed.copilot_plan === 'string' ? parsed.copilot_plan : undefined;
  return {
    groups: [
      {
        name: 'GitHub Copilot',
        description: plan ? `Plan: ${plan}` : undefined,
        buckets,
      },
    ],
  };
}
