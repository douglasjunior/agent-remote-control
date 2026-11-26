import type { SettingView } from '@agent-remote-control/protocol/settings';


/** How a duration setting is edited; the server, the protocol and the environment keep milliseconds. */
export type TimeUnit = {
  readonly name: 'minutes' | 'seconds';
  readonly singular: 'minute' | 'second';
  /** The compact form `formatDuration` writes this unit in. */
  readonly short: 'm' | ' s';
  readonly ms: number;
};

const MINUTES: TimeUnit = { name: 'minutes', singular: 'minute', short: 'm', ms: 60_000 };
const SECONDS: TimeUnit = { name: 'seconds', singular: 'second', short: ' s', ms: 1_000 };
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/** A `*_MS` integer is edited in seconds when its default is under a minute, and in minutes otherwise. */
export function timeUnitOf(view: SettingView): TimeUnit | undefined {
  if (view.kind !== 'integer' || !view.key.endsWith('_MS')) {
    return undefined;
  }
  return view.defaultValue < MINUTES.ms ? SECONDS : MINUTES;
}

/** The milliseconds as the number a field shows, with the decimals a whole millisecond needs. */
export function toUnitText(ms: number, unit: TimeUnit): string {
  return String(Number((ms / unit.ms).toFixed(6)));
}

/** The milliseconds a field's text stands for, or `null` when it is not a plain number. */
export function parseUnitText(text: string, unit: TimeUnit): number | null {
  const value = text.trim();
  return NUMBER.test(value) ? Math.round(Number(value) * unit.ms) : null;
}

/** `1 minute`, `1.5 minutes`, `30 seconds`. */
export function formatInUnit(ms: number, unit: TimeUnit): string {
  const text = toUnitText(ms, unit);
  return `${text} ${text === '1' ? unit.singular : unit.name}`;
}
