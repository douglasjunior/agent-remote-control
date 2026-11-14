import type { SkillSummary } from '@agent-remote-control/protocol/skill';
import { Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router';

import { agentIdentity } from '../../lib/agent-identity.js';
import { cn } from '../../lib/utils.js';
import { ChoiceSelect } from '../artifacts/choice-select.js';
import { Input } from '../ui/input.js';

import { skillsPath } from './skill-paths.js';
import { SkillRoles } from './skill-roles.js';


const ALL_ROLES = '';

function SkillGroup({ title, hint, skills }: {
  readonly title: string;
  readonly hint: string;
  readonly skills: readonly SkillSummary[];
}) {
  if (skills.length === 0) {
    return null;
  }
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <header className="flex items-baseline justify-between px-2 pt-2 pb-1">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{`${title} · ${skills.length}`}</h3>
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      </header>
      <ul className="flex flex-col gap-0.5">
        {skills.map(skill => (
          <li key={skill.name}>
            <NavLink
              to={skillsPath(skill.name)}
              className={({ isActive }) => cn(
                'flex flex-col gap-1.5 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isActive && 'bg-muted shadow-xs',
              )}
            >
              <span className="truncate font-mono text-[13px] font-medium">{skill.name}</span>
              <span className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{skill.description}</span>
              <SkillRoles roles={skill.roles} />
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every skill, the user's own first, filtered by text and by the role that reads it. */
export function SkillList({ skills }: { readonly skills: readonly SkillSummary[] }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState(ALL_ROLES);
  const roles = useMemo(() => [...new Set(skills.flatMap(skill => skill.roles))], [skills]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return skills.filter(skill => (role === ALL_ROLES || skill.roles.includes(role))
      && (text === '' || skill.name.toLowerCase().includes(text) || skill.description.toLowerCase().includes(text)));
  }, [skills, query, role]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-baseline justify-between px-0.5">
          <h2 className="font-heading text-sm font-semibold">Skills</h2>
          <span className="text-xs text-muted-foreground">What the agents read on demand</span>
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search skills" placeholder="Search skills" value={query} onChange={event => setQuery(event.target.value)} className="pl-8" />
        </div>
        <ChoiceSelect
          label="Filter by role"
          size="sm"
          value={role}
          onChange={setRole}
          choices={[{ value: ALL_ROLES, label: 'Every role' }, ...roles.map(value => ({ value, label: agentIdentity(value).label }))]}
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {visible.length === 0
          ? (
            <p className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Sparkles aria-hidden className="size-5" />
              No skill matches.
            </p>
          )
          : (
            <>
              <SkillGroup title="Custom" hint="yours to change" skills={visible.filter(skill => !skill.builtIn)} />
              <SkillGroup title="Built-in" hint="ships with the server" skills={visible.filter(skill => skill.builtIn)} />
            </>
          )}
      </div>
    </div>
  );
}
