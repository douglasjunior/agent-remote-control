import type { SkillDetail as Skill, SkillSummary } from '@agent-remote-control/protocol/skill';
import { BookOpenText, MessageSquarePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { useConnection } from '../../connection/connection-context.js';
import { useConversations } from '../../conversations/conversations-context.js';
import { cn } from '../../lib/utils.js';
import { SkillDetail } from '../skills/skill-detail.js';
import { SkillList } from '../skills/skill-list.js';
import { CREATE_SKILL_PROMPT } from '../skills/skill-prompts.js';
import { Button } from '../ui/button.js';

import { settingsState, skillsPath } from './settings-paths.js';
import { SettingsSectionHeader } from './settings-section-header.js';
import { sectionById } from './settings-sections.js';


/** The skills the agents read on demand: the list beside the skill picked from it, asked for again on every reconnection. */
export function SkillsSection() {
  const { connection, status } = useConnection();
  const { startConversation } = useConversations();
  const { skillName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const pendingDeletes = useRef(new Map<string, string>());
  const [skills, setSkills] = useState<readonly SkillSummary[] | null>(null);
  const [details, setDetails] = useState<Readonly<Record<string, Skill | null>>>({});
  const { label, description } = sectionById('skills');

  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'skills.list') {
      setSkills(event.skills);
    } else if (event.type === 'skill.detail') {
      setDetails(current => ({ ...current, [event.name]: event.skill }));
    } else if (event.type === 'skill.deleted') {
      // A deleted custom skill may have replaced a built-in one, which comes back: the list and the detail are asked for again.
      setDetails(({ [event.name]: _deleted, ...rest }) => rest);
      connection.send({ type: 'skills.list' });
      if (event.name === skillName) {
        connection.send({ type: 'skill.get', name: event.name });
      }
    } else if (event.type === 'skill.result' && pendingDeletes.current.has(event.requestId)) {
      const name = pendingDeletes.current.get(event.requestId)!;
      pendingDeletes.current.delete(event.requestId);
      if (event.ok) {
        toast.success(`${name} deleted`);
        void navigate(skillsPath(), { state: settingsState(location) });
      } else {
        toast.error(event.error);
      }
    }
  }), [connection, skillName, navigate, location]);

  const deleteSkill = (name: string) => {
    const requestId = crypto.randomUUID();
    pendingDeletes.current.set(requestId, name);
    connection.send({ type: 'skill.delete', requestId, name });
  };

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
            Skills are what the agents read on demand. Custom ones are yours: ask the CEO to create or change them.
          </p>
        </div>
      );
    }
    const detail = details[skillName];
    if (detail === undefined) {
      return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
    }
    return detail
      ? <SkillDetail key={detail.name} skill={detail} onDelete={() => deleteSkill(detail.name)} />
      : <p className="p-6 text-sm text-muted-foreground">{`No skill is named "${skillName}".`}</p>;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 py-5 sm:px-6">
        <SettingsSectionHeader
          title={label}
          description={description}
          action={(
            <Button variant="outline" size="sm" title="Ask the CEO for a new skill" onClick={() => startConversation(CREATE_SKILL_PROMPT)}>
              <MessageSquarePlus />
              New skill
            </Button>
          )}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] border-t @3xl/hub:grid-cols-[minmax(17rem,22rem)_1fr]">
        <aside aria-label="Skills" className={cn('min-h-0 border-r', skillName && 'hidden @3xl/hub:block')}>
          {skills === null
            ? <p role="status" className="p-6 text-sm text-muted-foreground">Loading skills…</p>
            : <SkillList skills={skills} />}
        </aside>
        <section aria-label="Skill" className={cn('@container min-h-0 overflow-y-auto', !skillName && 'hidden @3xl/hub:block')}>
          {renderDetail()}
        </section>
      </div>
    </div>
  );
}
