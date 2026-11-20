import type { Squad } from '@agent-remote-control/protocol/squad';
import { Plus, Users, X } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router';

import { cn } from '../../lib/utils.js';
import { IconButton } from '../icon-button.js';
import { SkillRoles } from '../skills/skill-roles.js';
import { Badge } from '../ui/badge.js';
import { buttonVariants } from '../ui/button.js';

import { NEW_SQUAD_PATH, squadsPath, squadsState } from './squad-paths.js';


/** Every squad by name, the default one marked, each with the roles it sets. */
export function SquadList({ squads, onClose }: { readonly squads: readonly Squad[]; readonly onClose: () => void }) {
  const location = useLocation();
  const state = squadsState(location);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center justify-between gap-2 pl-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="font-heading text-sm font-semibold">Squads</h2>
            <span className="truncate text-xs text-muted-foreground">Who runs each role, set in one go</span>
          </div>
          <IconButton variant="ghost" size="icon-sm" label="Close squads" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <Link to={NEW_SQUAD_PATH} state={state} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'self-end' })}>
          <Plus />
          New squad
        </Link>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {squads.length === 0
          ? (
            <p className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Users aria-hidden className="size-5" />
              No squad yet. Create one, or save the setup of a conversation as a squad from its settings.
            </p>
          )
          : (
            <ul className="flex flex-col gap-0.5">
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
          )}
      </div>
    </div>
  );
}
