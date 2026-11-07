import type { AgentQuotaBucket, AgentQuotaReport } from '@agent-remote-control/protocol/agent-quota';


export type QuotaLevel = 'good' | 'attention' | 'critical';

export const LEVEL_FILL: Record<QuotaLevel, string> = {
  good: 'bg-good',
  attention: 'bg-attention',
  critical: 'bg-destructive',
};

export const LEVEL_TEXT: Record<QuotaLevel, string> = {
  good: 'text-good',
  attention: 'text-attention',
  critical: 'text-destructive',
};

const WINDOW_LABELS: Readonly<Record<string, string>> = {
  '5h': '5h',
  '7d': 'Week',
  weekly: 'Week',
  monthly: 'Month',
};

export function clampFraction(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

export function quotaLevel(fraction: number): QuotaLevel {
  const clamped = clampFraction(fraction);
  return clamped >= 0.5 ? 'good' : clamped >= 0.2 ? 'attention' : 'critical';
}

/** The percent of the limit already used, from the remaining fraction. */
export function quotaPercent(fraction: number): number {
  return Math.round((1 - clampFraction(fraction)) * 100);
}

export function windowLabel(bucket: AgentQuotaBucket): string {
  return WINDOW_LABELS[bucket.window] ?? bucket.name;
}

/**
 * The window names the limit unless another limit of the group shares it, as Claude's weekly ones do:
 * then the qualifier in the bucket's name tells them apart (`Week · Sonnet only`).
 */
export function bucketLabel(bucket: AgentQuotaBucket, siblings: readonly AgentQuotaBucket[]): string {
  const label = windowLabel(bucket);
  if (siblings.filter(sibling => windowLabel(sibling) === label).length < 2) {
    return label;
  }
  const qualifier = /\(([^)]+)\)/.exec(bucket.name)?.[1];
  return qualifier ? `${label} · ${qualifier}` : bucket.name;
}

/** The remaining fraction of the agent's closest limit; `undefined` when the agent reports none. */
export function tightestFraction(report: AgentQuotaReport): number | undefined {
  const fractions = (report.quota?.groups ?? []).flatMap(group => group.buckets.map(bucket => clampFraction(bucket.remainingFraction)));
  return fractions.length > 0 ? Math.min(...fractions) : undefined;
}

/** The remaining fraction of the closest limit across the agents; `undefined` when no agent reports one. */
export function lowestFraction(reports: readonly AgentQuotaReport[]): number | undefined {
  const fractions = reports.map(tightestFraction).filter(fraction => fraction !== undefined);
  return fractions.length > 0 ? Math.min(...fractions) : undefined;
}
