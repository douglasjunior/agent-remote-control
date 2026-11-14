import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { AgentMark } from '../agent/agent-mark.js';


/** The roles that read a skill: colored dots in a list, marks with names in the detail. */
export function SkillRoles({ roles, detailed = false, className }: {
  readonly roles: readonly string[];
  readonly detailed?: boolean;
  readonly className?: string;
}) {
  return (
    <ul aria-label="Read by" className={cn('flex flex-wrap items-center', detailed ? 'gap-3' : 'gap-x-2.5 gap-y-1', className)}>
      {roles.map((role) => {
        const { label, color } = agentIdentity(role);
        return (
          <li key={role} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            {detailed
              ? <AgentMark role={role} size="sm" />
              : <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />}
            {label}
          </li>
        );
      })}
    </ul>
  );
}
