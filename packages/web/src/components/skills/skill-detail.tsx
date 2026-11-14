import type { SkillDetail as Skill } from '@agent-remote-control/protocol/skill';
import { ArrowLeft, Lock, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

import { useConversations } from '../../conversations/conversations-context.js';
import { Markdown } from '../entries/markdown.js';
import { IconButton } from '../icon-button.js';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

import { changeSkillPrompt, skillsPath } from './skill-paths.js';
import { SkillRoles } from './skill-roles.js';


function DeleteSkillButton({ name, onDelete }: { readonly name: string; readonly onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton variant="ghost" label="Delete" onClick={() => setOpen(true)} className="shrink-0 text-muted-foreground hover:text-destructive">
        <Trash2 />
      </IconButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete the skill ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from the server for good, and the agents that read it stop seeing it from their next session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A skill in full; a custom one can be changed by asking the Coordinator in a new conversation, or deleted. */
export function SkillDetail({ skill, onDelete }: { readonly skill: Skill; readonly onDelete: () => void }) {
  const { startConversation } = useConversations();
  const { state } = useLocation();

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <Link to={skillsPath()} state={state} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden">
        <ArrowLeft aria-hidden className="size-4" />
        All skills
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
          {!skill.builtIn && <DeleteSkillButton name={skill.name} onDelete={onDelete} />}
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
            <Button size="sm" className="h-auto min-h-8 w-full shrink-0 py-1.5 whitespace-normal @lg:w-auto" onClick={() => startConversation(changeSkillPrompt(skill.name))}>
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
