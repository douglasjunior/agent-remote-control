import type {
  AgentQuota,
  AgentQuotaBucket,
} from '../ports/agent.port.js';


const LIMIT_LINE = /^(.+?):\s*(\d+(?:\.\d+)?)%\s+used(?:\s*·\s*resets\s+(.+?))?\s*$/;
const RESET_TIME = /^(?:([A-Z][a-z]{2})\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

const windowOf = (label: string): string => {
  if (/session/i.test(label)) return '5h';
  if (/week/i.test(label)) return '7d';
  return 'limit';
};

const slug = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Offset in ms of `timeZone` from UTC at the given instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const value = (type: string): number =>
    Number(parts.find(part => part.type === type)?.value);
  const wallClock = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return wallClock - Math.floor(instant / 1000) * 1000;
}

function wallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month, day, hour, minute);
  const first = naive - zoneOffset(naive, timeZone);
  return naive - zoneOffset(first, timeZone);
}

/**
 * `/usage` prints resets as `Oct 30, 11:29pm (America/Sao_Paulo)`, or just
 * `11:29pm (America/Sao_Paulo)` for the current day, always without a year.
 * Resolves to the first matching instant that is not in the past.
 */
function parseResetTime(text: string, now: Date): string | undefined {
  const match = RESET_TIME.exec(text.trim());
  if (!match) return undefined;
  const [, monthName, dayText, hourText, minuteText, meridiem, timeZone] = match;
  let hour = Number(hourText) % 12;
  if (meridiem?.toLowerCase() === 'pm') hour += 12;
  const minute = Number(minuteText ?? 0);
  try {
    const today = new Date(now.getTime() + zoneOffset(now.getTime(), timeZone!));
    let month = today.getUTCMonth();
    let day = today.getUTCDate();
    const year = today.getUTCFullYear();
    const dated = monthName !== undefined;
    if (dated) {
      month = MONTHS.indexOf(monthName.toLowerCase());
      day = Number(dayText);
      if (month < 0) return undefined;
    }
    let instant = wallClockToInstant(year, month, day, hour, minute, timeZone!);
    if (instant < now.getTime()) {
      instant = dated
        ? wallClockToInstant(year + 1, month, day, hour, minute, timeZone!)
        : instant + DAY_MS;
    }
    return new Date(instant).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Parses the stdout of `claude -p /usage`: one `<label>: <N>% used · resets
 * <time> (<zone>)` line per limit. Other lines are ignored; returns
 * `undefined` when no limit line is found.
 */
export function parseClaudeUsageOutput(
  output: string,
  now: Date = new Date(),
): AgentQuota | undefined {
  const buckets: AgentQuotaBucket[] = [];
  for (const line of output.split('\n')) {
    const match = LIMIT_LINE.exec(line.trim());
    if (!match) continue;
    const [, label, percent, reset] = match;
    buckets.push({
      id: slug(label!),
      name: label!,
      window: windowOf(label!),
      remainingFraction: Math.max(0, 1 - Number(percent) / 100),
      resetTime: reset ? parseResetTime(reset, now) : undefined,
    });
  }
  return buckets.length > 0
    ? { groups: [{ name: 'Claude Code', buckets }] }
    : undefined;
}
