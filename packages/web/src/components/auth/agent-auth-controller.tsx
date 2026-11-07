import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../ui/button.js';

import { AgentAuthPopover } from './agent-auth-popover.js';
import { LoginCode, LoginLink } from './agent-login-card.js';
import { type AgentLoginState, IDLE } from './agent-login-state.js';
import { useAgentAuthStatus } from './use-agent-auth-status.js';


const SUCCESS_TOAST_MS = 5_000;

const toastId = (agentId: string) => `auth-${agentId}`;

/**
 * Owns the login state of the agents: the header popover, and one toast per agent that cannot run
 * until it is logged in or whose login is in progress. Those toasts never time out and cannot be
 * dismissed; they go away when the agent is logged in or the login is cancelled. A code the user
 * has to paste is typed in the popover, which the toast opens. The toast has one action button (sonner
 * ignores a second one on a toast that cannot be dismissed), so Cancel sits in the description there.
 */
export function AgentAuthController() {
  const [open, setOpen] = useState(false);
  const names = useRef(new Map<string, string>());
  const shown = useRef(new Set<string>());
  const auth = useAgentAuthStatus((agentId) => {
    toast.success(`${names.current.get(agentId) ?? agentId} is logged in`, {
      id: toastId(agentId),
      duration: SUCCESS_TOAST_MS,
      dismissible: true,
    });
    shown.current.delete(agentId);
  });
  const { agents, loginStates, login, cancel } = auth;

  useEffect(() => {
    if (agents === null) {
      return;
    }
    const wanted = new Set<string>();
    for (const agent of agents) {
      names.current.set(agent.agentId, agent.displayName);
      const state: AgentLoginState = loginStates[agent.agentId] ?? IDLE;
      if (state.kind === 'idle' && agent.status !== 'unauthenticated') {
        continue;
      }
      wanted.add(agent.agentId);
      const base = { id: toastId(agent.agentId), duration: Infinity, dismissible: false } as const;
      const name = agent.displayName;
      switch (state.kind) {
        case 'idle':
          toast.warning(`${name} is not logged in`, {
            ...base,
            action: { label: 'Authenticate', onClick: () => login(agent.agentId) },
          });
          break;
        case 'starting':
          toast.loading(`Starting the ${name} login…`, base);
          break;
        case 'waiting':
          toast.loading(`Log in to ${name}`, {
            ...base,
            description: (
              <span className="flex flex-col gap-1.5">
                <LoginLink url={state.url} />
                {state.code && <LoginCode code={state.code} />}
              </span>
            ),
            action: { label: 'Cancel', onClick: () => cancel(agent.agentId) },
          });
          break;
        case 'verifying':
          toast.loading('Checking the code…', {
            ...base,
            description: `Finishing the ${name} login.`,
            action: { label: 'Cancel', onClick: () => cancel(agent.agentId) },
          });
          break;
        case 'prompt':
          toast.loading(`Log in to ${name}`, {
            ...base,
            description: (
              <span className="flex flex-col gap-1.5">
                <LoginLink url={state.url} />
                <span>Paste the code the browser shows.</span>
                <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => cancel(agent.agentId)}>
                  Cancel
                </Button>
              </span>
            ),
            action: { label: 'Enter code', onClick: () => setOpen(true) },
          });
          break;
        case 'failed':
          toast.error(`${name} login failed`, {
            ...base,
            description: state.reason,
            action: { label: 'Try again', onClick: () => login(agent.agentId) },
          });
          break;
      }
    }
    for (const agentId of shown.current) {
      if (!wanted.has(agentId)) {
        toast.dismiss(toastId(agentId));
      }
    }
    shown.current = wanted;
  }, [agents, loginStates, login, cancel]);

  return <AgentAuthPopover auth={auth} open={open} onOpenChange={setOpen} />;
}
