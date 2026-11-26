import { ChevronRight } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';

import { cn } from '../../lib/utils.js';

import type { SectionMark } from './server-settings-provider.js';
import { settingsPath, settingsState } from './settings-paths.js';
import { SETTINGS_SECTIONS } from './settings-sections.js';
import type { ServerSectionId } from './settings-sections.js';


const MARK_LABELS: Readonly<Record<SectionMark, { readonly label: string; readonly dot: string }>> = {
  invalid: { label: 'has an invalid value', dot: 'bg-destructive' },
  unsaved: { label: 'has unsaved changes', dot: 'bg-attention' },
};

/**
 * The sections of the hub, with a dot on the ones that hold an unsaved or an invalid draft. Beside the section it is
 * a compact column; alone on a phone each section is a row with its description.
 */
export function SettingsNav({ wide, marks }: {
  readonly wide: boolean;
  readonly marks: ReadonlyMap<ServerSectionId, SectionMark>;
}) {
  const location = useLocation();
  const state = settingsState(location);

  return (
    <nav aria-label="Settings sections" className={cn('min-h-0 overflow-y-auto p-3', wide ? 'w-56 shrink-0 border-r' : 'flex-1')}>
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map(({ id, label, description, icon: Icon }) => {
          const mark = marks.get(id as ServerSectionId);
          return (
            <li key={id}>
              <NavLink
                to={settingsPath(id)}
                state={state}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 rounded-xl px-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  wide ? 'py-2' : 'py-3',
                  isActive && wide && 'bg-muted shadow-xs',
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {label}
                    {mark && (
                      <>
                        {' '}
                        <span aria-hidden className={`inline-block size-1.5 rounded-full align-middle ${MARK_LABELS[mark].dot}`} />
                        <span className="sr-only">{`(${MARK_LABELS[mark].label})`}</span>
                      </>
                    )}
                  </span>
                  {!wide && <span className="text-xs text-muted-foreground">{description}</span>}
                </span>
                {!wide && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
