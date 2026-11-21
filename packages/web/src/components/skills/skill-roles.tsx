import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { AgentMark } from '../agent/agent-mark.js';


/** Roles as colored dots in a list, or marks with names in a detail: those that read a skill, or that a squad sets. */
export function SkillRoles({ roles, detailed = false, className, label = 'Read by' }: {
  readonly roles: readonly string[];
  readonly detailed?: boolean;
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <ul aria-label={label} className={cn('flex flex-wrap items-center', detailed ? 'gap-3' : 'gap-x-2.5 gap-y-1', className)}>
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
