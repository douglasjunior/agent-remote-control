import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';

import { LEVEL_FILL, LEVEL_TEXT, lowestFraction, quotaLevel, quotaPercent, tightestFraction } from './quota-level.js';
import { UsagePanel } from './usage-panel.js';
import { useAgentQuota } from './use-agent-quota.js';


const PLACEHOLDER_METERS = ['first', 'second', 'third', 'fourth'];

function Meter({ fraction, loading = false }: { readonly fraction?: number; readonly loading?: boolean }) {
  const level = fraction === undefined ? undefined : quotaLevel(fraction);

  return (
    <span className={cn('relative block h-4 w-1 overflow-hidden rounded-full bg-muted-foreground/25', loading && 'motion-safe:animate-pulse')}>
      {fraction !== undefined && level !== undefined && (
        <span
          data-level={level}
          className={cn('absolute inset-x-0 bottom-0 rounded-full motion-safe:transition-[height] motion-safe:duration-500', LEVEL_FILL[level], level === 'critical' && 'motion-safe:animate-pulse')}
          style={{ height: `${quotaPercent(fraction)}%` }}
        />
      )}
    </span>
  );
}

/** Always on screen: one meter per agent, each at its closest limit, and the highest percent used. A click opens every limit. */
export function UsageIndicator() {
  const quota = useAgentQuota();
  const { reports, failed } = quota;
  const lowest = lowestFraction(reports ?? []);
  const label = lowest === undefined ? 'Agent usage' : `Agent usage, highest ${quotaPercent(lowest)}% used`;

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={label} className="gap-2" />}>
        <span aria-hidden className="flex items-center gap-[3px]">
          {reports !== null && reports.length > 0
            ? reports.map(report => <Meter key={report.agent.id} fraction={tightestFraction(report)} />)
            : PLACEHOLDER_METERS.map(id => <Meter key={id} loading={reports === null && !failed} />)}
        </span>
        <span aria-hidden className={cn('font-mono text-xs tabular-nums', lowest === undefined ? 'text-muted-foreground' : LEVEL_TEXT[quotaLevel(lowest)])}>
          {lowest === undefined ? '–' : `${quotaPercent(lowest)}%`}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(80dvh,640px)] w-[min(360px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <UsagePanel quota={quota} />
      </PopoverContent>
    </Popover>
  );
}
