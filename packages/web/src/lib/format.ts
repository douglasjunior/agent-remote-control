const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

export function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs / 1000)} s`;
}
