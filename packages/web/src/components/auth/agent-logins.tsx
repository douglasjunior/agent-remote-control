import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

import { useAgentAuth } from './agent-auth-provider.js';
import { AgentLoginCard } from './agent-login-card.js';
import { IDLE } from './agent-login-state.js';


const STATUS_LABEL = {
  authenticated: 'Logged in',
  unauthenticated: 'Not logged in',
  unknown: 'Unknown',
} as const;

/** Login state of every agent CLI, with the button that logs it in and the card of a login in progress. */
export function AgentLogins() {
  const { agents, loginStates, login, submitCode, cancel } = useAgentAuth();

  return (
    <section aria-labelledby="agent-logins" className="flex flex-col gap-2">
      <h4 id="agent-logins" className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Logins</h4>
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {agents === null && <p className="px-4 py-3 text-sm text-muted-foreground">Checking the agents…</p>}
        {agents?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No agent supports login here.</p>}
        <ul className="divide-y">
          {agents?.map((agent) => {
            const state = loginStates[agent.agentId] ?? IDLE;
            const busy = state.kind !== 'idle' && state.kind !== 'failed';
            return (
              <li key={agent.agentId} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
      </div>
    </section>
  );
}
