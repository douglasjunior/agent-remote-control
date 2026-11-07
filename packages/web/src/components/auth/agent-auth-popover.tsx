import { KeyRound } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';

import { AgentLoginCard } from './agent-login-card.js';
import { IDLE } from './agent-login-state.js';
import type { AgentAuthView } from './use-agent-auth-status.js';


const STATUS_LABEL = {
  authenticated: 'Logged in',
  unauthenticated: 'Not logged in',
  unknown: 'Unknown',
} as const;

type AgentAuthPopoverProps = {
  readonly auth: AgentAuthView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

/** Login state of every agent CLI in the header, with the button that logs it in. */
export function AgentAuthPopover({ auth, open, onOpenChange }: AgentAuthPopoverProps) {
  const { agents, loginStates, login, submitCode, cancel } = auth;
  const needsLogin = useMemo(() => agents?.some(agent => agent.status === 'unauthenticated') ?? false, [agents]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" aria-label={needsLogin ? 'Agent logins, login needed' : 'Agent logins'} className="gap-2" />}
      >
        <KeyRound aria-hidden />
        {needsLogin && <span aria-hidden className="size-2 rounded-full bg-destructive" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(80dvh,640px)] w-[min(380px,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto p-3">
        <h2 className="text-sm font-semibold">Agent logins</h2>
        {agents === null && <p className="text-sm text-muted-foreground">Checking the agents…</p>}
        {agents?.length === 0 && <p className="text-sm text-muted-foreground">No agent supports login here.</p>}
        <ul className="flex flex-col gap-3">
          {agents?.map((agent) => {
            const state = loginStates[agent.agentId] ?? IDLE;
            const busy = state.kind !== 'idle' && state.kind !== 'failed';
            return (
              <li key={agent.agentId} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{agent.displayName}</span>
                    {agent.detail && <span className="truncate text-xs text-muted-foreground">{agent.detail}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={agent.status === 'authenticated' ? 'secondary' : agent.status === 'unknown' ? 'outline' : 'destructive'}>
                      {STATUS_LABEL[agent.status]}
                    </Badge>
                    <Button
                      size="sm"
                      variant={agent.status === 'authenticated' ? 'outline' : 'default'}
                      disabled={busy}
                      aria-label={`${agent.status === 'authenticated' ? 'Re-authenticate' : 'Authenticate'} ${agent.displayName}`}
                      onClick={() => login(agent.agentId)}
                    >
                      {agent.status === 'authenticated' ? 'Re-authenticate' : 'Authenticate'}
                    </Button>
                  </div>
                </div>
                {state.kind === 'failed' && <p role="alert" className="text-sm text-destructive">{state.reason}</p>}
                <AgentLoginCard
                  agentName={agent.displayName}
                  state={state}
                  onSubmitCode={text => submitCode(agent.agentId, text)}
                  onCancel={() => cancel(agent.agentId)}
                />
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
