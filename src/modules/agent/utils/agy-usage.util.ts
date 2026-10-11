import type {
  AgentQuota,
  AgentQuotaBucket,
  AgentQuotaGroup,
} from '../ports/agent.port.js';


type RawBucket = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly window?: unknown;
  readonly remaining_fraction?: unknown;
  readonly reset_time?: unknown;
};

type RawGroup = {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly buckets?: unknown;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const parseBucket = (raw: RawBucket): AgentQuotaBucket | undefined => {
  const id = asString(raw.id);
  const name = asString(raw.name);
  const window = asString(raw.window);
  if (
    !id
    || !name
    || !window
    || typeof raw.remaining_fraction !== 'number'
  ) {
    return undefined;
  }
  return {
    id,
    name,
    window,
    remainingFraction: raw.remaining_fraction,
    resetTime: asString(raw.reset_time),
    description: asString(raw.description),
  };
};

const parseGroup = (raw: RawGroup): AgentQuotaGroup | undefined => {
  const name = asString(raw.name);
  if (!name || !Array.isArray(raw.buckets)) {
    return undefined;
  }
  const buckets = (raw.buckets as RawBucket[])
    .map(parseBucket)
    .filter((bucket): bucket is AgentQuotaBucket => bucket !== undefined);
  return { name, description: asString(raw.description), buckets };
};

/**
 * Parses the stdout of `agy --output-format json --print /usage`. Tolerates
 * log noise around the JSON document; returns `undefined` when the payload is
 * not a successful `usage` command result.
 */
export function parseAgyUsageOutput(output: string): AgentQuota | undefined {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) {
    return undefined;
  }
  let parsed: {
    status?: unknown;
    command?: { name?: unknown; data?: { description?: unknown; groups?: unknown } };
  };
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const data = parsed.command?.data;
  if (
    parsed.status !== 'SUCCESS'
    || parsed.command?.name !== 'usage'
    || !data
    || !Array.isArray(data.groups)
  ) {
    return undefined;
  }
  const groups = (data.groups as RawGroup[])
    .map(parseGroup)
    .filter((group): group is AgentQuotaGroup => group !== undefined);
  return { description: asString(data.description), groups };
}
