import { CircleAlert, CircleCheck, LoaderCircle, PlugZap } from 'lucide-react';

import { Button } from '../ui/button.js';


export type DiscordTestResult = { readonly ok: true; readonly botName: string; readonly guildName?: string } | { readonly ok: false; readonly error: string };

export type DiscordTestState = { readonly status: 'idle' | 'testing' } | { readonly status: 'done'; readonly result: DiscordTestResult };

/** Tests the bot token and the server ID in the form, or the saved ones, without saving anything. */
export function DiscordConnectionTest({ state, onTest }: { readonly state: DiscordTestState; readonly onTest: () => void }) {
  const testing = state.status === 'testing';
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-snug text-muted-foreground">
          Checks the token in the form, or the saved one, and the server ID, without saving them.
        </p>
        <Button variant="outline" size="sm" className="shrink-0 self-end sm:self-auto" disabled={testing} onClick={onTest}>
          {testing ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : <PlugZap aria-hidden />}
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
      {state.status === 'done' && <TestResult result={state.result} />}
    </div>
  );
}

function TestResult({ result }: { readonly result: DiscordTestResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {result.error}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--good)_12%,var(--card))] px-3 py-2 text-sm">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
      <span>
        {'Connected as '}
        <strong>{result.botName}</strong>
        {result.guildName && (
          <>
            {' in '}
            <strong>{result.guildName}</strong>
          </>
        )}
        .
      </span>
    </p>
  );
}
