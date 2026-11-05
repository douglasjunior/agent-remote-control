import type { AgentQuotaBucket, AgentQuotaReport } from '@agent-remote-control/protocol/agent-quota';
import { LoaderCircle, RefreshCw } from 'lucide-react';

import { formatCountdown, formatRelativeTime } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';

import {
  bucketLabel, clampFraction, LEVEL_FILL, LEVEL_TEXT, quotaLevel, quotaPercent, tightestFraction,
} from './quota-level.js';
import type { AgentQuotaView } from './use-agent-quota.js';


const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_64px_2.5rem_3rem] items-center gap-x-2.5 px-2';
const CAPTION = 'text-[11.5px] font-medium tracking-[.05em] text-muted-foreground/80 uppercase';
const MINUTE_MS = 60_000;

function ResetCell({ resetTime, now }: { readonly resetTime: string | undefined; readonly now: number }) {
  const remaining = resetTime === undefined ? Number.NaN : Date.parse(resetTime) - now;
  if (Number.isNaN(remaining) || remaining <= 0) {
    return <span />;
  }
  const spoken = remaining < MINUTE_MS ? 'resets in under a minute' : `resets ${formatRelativeTime(resetTime!, now)}`;

  return (
    <span title={spoken} className="text-right font-mono text-xs text-muted-foreground tabular-nums">
      <span aria-hidden>{formatCountdown(remaining)}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

function BucketRow({ bucket, label, now }: {
  readonly bucket: AgentQuotaBucket;
  readonly label: string;
  readonly now: number;
}) {
  const level = quotaLevel(bucket.remainingFraction);

  return (
    <li data-level={level} className={cn(COLUMNS, 'rounded-lg py-1 transition-colors duration-300 hover:bg-foreground/5', level === 'critical' && 'bg-destructive/10')}>
      <span title={label} className="min-w-0 truncate text-[13.5px]">{label}</span>
      <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', LEVEL_FILL[level])}
          style={{ width: `${clampFraction(bucket.remainingFraction) * 100}%` }}
        />
      </span>
      <span className={cn('text-right font-mono text-[12.5px] tabular-nums', level === 'good' ? 'text-foreground' : `font-semibold ${LEVEL_TEXT[level]}`)}>
        {`${quotaPercent(bucket.remainingFraction)}%`}
        <span className="sr-only"> left</span>
      </span>
      <ResetCell resetTime={bucket.resetTime} now={now} />
    </li>
  );
}

function AgentSection({ report, now }: { readonly report: AgentQuotaReport; readonly now: number }) {
  const groups = report.quota?.groups ?? [];
  const tightest = tightestFraction(report);

  return (
    <section className="py-2 first:pt-1 last:pb-1">
      <div className="flex items-center gap-2 px-2 pb-0.5">
        {tightest !== undefined && <i aria-hidden className={cn('size-[7px] shrink-0 rounded-full', LEVEL_FILL[quotaLevel(tightest)])} />}
        <h4 className="min-w-0 flex-1 truncate font-heading text-[14.5px] leading-[1.4] font-semibold">{report.agent.name}</h4>
        {tightest === undefined && (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {report.status === 'failed' ? 'Could not read usage' : 'No usage data'}
          </span>
        )}
      </div>
      {groups.map(group => (
        <div key={group.name}>
          {groups.length > 1 && <p className={cn(CAPTION, 'px-2 pt-1.5 pb-0.5 text-[10.5px]')}>{group.name}</p>}
          <ul>
            {group.buckets.map(bucket => (
              <BucketRow key={bucket.id} bucket={bucket} label={bucketLabel(bucket, group.buckets)} now={now} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** One line per limit in aligned columns, so the eye runs down the percents and only low limits draw color. */
export function UsagePanel({ quota }: { readonly quota: AgentQuotaView }) {
  const now = useNow(true);
  const { reports, fetchedAt, refreshing, failed, refresh } = quota;

  return (
    <div className="flex min-h-0 flex-col motion-safe:animate-in motion-safe:fade-in">
      <header className="flex items-center justify-between gap-3 py-2 pr-2 pl-4">
        <div className="min-w-0">
          <h3 className="font-heading text-[17px] leading-tight font-semibold">Agent usage</h3>
          {failed
            ? <p className="text-xs font-medium text-attention">Could not refresh</p>
            : fetchedAt && <p className="text-xs text-muted-foreground">{`Updated ${formatRelativeTime(fetchedAt, Math.max(now, Date.parse(fetchedAt)))}`}</p>}
        </div>
        <IconButton variant="ghost" size="icon-sm" label="Refresh usage" disabled={refreshing} onClick={refresh}>
          <RefreshCw className={cn(refreshing && 'motion-safe:animate-spin')} />
        </IconButton>
      </header>
      {reports !== null && reports.length > 0 && (
        <div aria-hidden className={cn(COLUMNS, CAPTION, 'mx-2 border-y py-1 text-[10.5px]')}>
          <span>Limit</span>
          <span />
          <span className="text-right">Left</span>
          <span className="text-right">Resets</span>
        </div>
      )}
      <div className="min-h-0 flex-1 divide-y overflow-y-auto px-2 pb-2">
        {reports === null && !failed && (
          <p className="flex items-center gap-2 px-2 py-2.5 text-[13.5px] text-muted-foreground">
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
            Reading the limits…
          </p>
        )}
        {reports?.length === 0 && <p className="px-2 py-2.5 text-[13.5px] text-muted-foreground">No agent CLI was found in the PATH.</p>}
        {reports?.map(report => <AgentSection key={report.agent.id} report={report} now={now} />)}
      </div>
    </div>
  );
}
