import type { SkillDetail as Skill, SkillSummary } from '@agent-remote-control/protocol/skill';
import { BookOpenText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { SkillDetail } from '../components/skills/skill-detail.js';
import { SkillList } from '../components/skills/skill-list.js';
import { useConnection } from '../connection/connection-context.js';
import { cn } from '../lib/utils.js';


/** The skills the agents read on demand: the list beside the skill picked from it, asked for again on every reconnection. */
export function SkillsPage() {
  const { connection, status } = useConnection();
  const { skillName } = useParams();
  const [skills, setSkills] = useState<readonly SkillSummary[] | null>(null);
  const [details, setDetails] = useState<Readonly<Record<string, Skill | null>>>({});

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'skills.list') {
      setSkills(event.skills);
    } else if (event.type === 'skill.detail') {
      setDetails(current => ({ ...current, [event.name]: event.skill }));
    }
  }), [connection]);

  useEffect(() => {
    if (status === 'open') {
      connection.send({ type: 'skills.list' });
    }
  }, [connection, status]);

  useEffect(() => {
    if (status === 'open' && skillName) {
      connection.send({ type: 'skill.get', name: skillName });
    }
  }, [connection, status, skillName]);

  const renderDetail = () => {
    if (!skillName) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><BookOpenText aria-hidden /></span>
          <p className="font-heading text-base font-medium">Pick a skill</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Skills are what the agents read on demand. Custom ones are yours: ask the Coordinator to create or change them.
          </p>
        </div>
      );
    }
    const detail = details[skillName];
    if (detail === undefined) {
      return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
    }
    return detail
      ? <SkillDetail key={detail.name} skill={detail} />
      : <p className="p-6 text-sm text-muted-foreground">{`No skill is named "${skillName}".`}</p>;
  };

  return (
    <div className="grid h-full md:grid-cols-[minmax(17rem,22rem)_1fr]">
      <aside aria-label="Skills" className={cn('min-h-0 border-r', skillName && 'hidden md:block')}>
        {skills === null
          ? <p role="status" className="p-6 text-sm text-muted-foreground">Loading skills…</p>
          : <SkillList skills={skills} />}
      </aside>
      <section aria-label="Skill" className={cn('@container min-h-0 overflow-y-auto', !skillName && 'hidden md:block')}>
        {renderDetail()}
      </section>
    </div>
  );
}
