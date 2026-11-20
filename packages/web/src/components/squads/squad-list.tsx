import type { Squad } from '@agent-remote-control/protocol/squad';
import { Users } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';

import { cn } from '../../lib/utils.js';
import { settingsState, squadsPath } from '../settings-hub/settings-paths.js';
import { SkillRoles } from '../skills/skill-roles.js';
import { Badge } from '../ui/badge.js';


/** Every squad by name, the default one marked, each with the roles it sets. */
export function SquadList({ squads }: { readonly squads: readonly Squad[] }) {
  const state = settingsState(useLocation());

  if (squads.length === 0) {
    return (
      <p className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <Users aria-hidden className="size-5" />
        No squad yet. Create one, or save the setup of a conversation as a squad from its settings.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {squads.map(squad => (
        <li key={squad.id}>
          <NavLink
            to={squadsPath(squad.id)}
            state={state}
            className={({ isActive }) => cn(
              'flex flex-col gap-1.5 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isActive && 'bg-muted shadow-xs',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium">{squad.name}</span>
              {squad.isDefault && <Badge variant="secondary">Default</Badge>}
            </span>
            {squad.description && <span className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{squad.description}</span>}
            <SkillRoles roles={squad.profiles.map(profile => profile.role)} label="Sets" />
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
