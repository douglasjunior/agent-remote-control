import type { SkillDetail as Skill } from '@agent-remote-control/protocol/skill';
import { ArrowLeft, Lock, MessageSquarePlus } from 'lucide-react';
import { Link } from 'react-router';

import { useConversations } from '../../conversations/conversations-context.js';
import { Markdown } from '../entries/markdown.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

import { changeSkillPrompt, skillsPath } from './skill-paths.js';
import { SkillRoles } from './skill-roles.js';


/** A skill in full; a custom one can be changed by asking the Coordinator in a new conversation. */
export function SkillDetail({ skill }: { readonly skill: Skill }) {
  const { startConversation } = useConversations();

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <Link to={skillsPath()} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden">
        <ArrowLeft aria-hidden className="size-4" />
        All skills
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-semibold break-all">{skill.name}</h2>
          {skill.builtIn
            ? (
              <Badge variant="secondary">
                <Lock aria-hidden />
                Built-in
              </Badge>
            )
            : <Badge variant="outline">Custom</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{skill.description}</p>
        <SkillRoles roles={skill.roles} detailed />
      </header>
      {skill.builtIn
        ? (
          <p className="rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
            Built-in skills ship with the server and are read-only. To teach the agents something else, ask the Coordinator for a custom skill.
          </p>
        )
        : (
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 px-4 py-3 @lg:flex-row @lg:items-center @lg:justify-between">
            <p className="text-[13px] text-muted-foreground">Want it to say something else? The Coordinator rewrites it for you.</p>
            <Button size="sm" className="shrink-0" onClick={() => startConversation(changeSkillPrompt(skill.name))}>
              <MessageSquarePlus />
              Ask the Coordinator
            </Button>
          </div>
        )}
      <div className="rounded-2xl border bg-card px-5 py-4">
        <Markdown text={skill.content} />
      </div>
    </article>
  );
}
