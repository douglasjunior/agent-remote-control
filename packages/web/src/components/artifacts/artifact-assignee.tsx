import type { ArtifactAssignee as Assignee } from '@agent-remote-control/protocol/artifact';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { AgentMark } from '../agent/agent-mark.js';


/** The agent holding an artifact, glowing while it works on it; `compact` leaves only the mark. */
export function ArtifactAssignee({ assignee, compact = false, className }: {
  readonly assignee: Assignee;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const { label } = agentIdentity(assignee.role, assignee.roleName);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={`${label} is working on it`}>
      <AgentMark role={assignee.role} roleName={assignee.roleName} state="working" size="sm" />
      {!compact && <span className="truncate text-[12.5px] text-muted-foreground">{label}</span>}
    </span>
  );
}
