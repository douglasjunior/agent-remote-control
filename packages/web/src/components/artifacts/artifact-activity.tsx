import type { ArtifactActor, ArtifactFieldChange, ArtifactHistoryEvent } from '@agent-remote-control/protocol/artifact';
import { Cpu, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { SECTION_LABELS, STATUS_LABELS, REFINEMENT_LABELS } from '../../artifacts/artifact-labels.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import { formatRelativeTime } from '../../lib/format.js';
import { useNow } from '../../lib/use-now.js';
import { AgentMark } from '../agent/agent-mark.js';
import { Markdown } from '../entries/markdown.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';


const VALUE_LABELS: Readonly<Record<string, string>> = { ...STATUS_LABELS, ...REFINEMENT_LABELS };
const SECTION_PREFIX = 'section:';

function actorName(actor: ArtifactActor): string {
  if (actor.kind === 'agent') {
    return agentIdentity(actor.role, actor.roleName).label;
  }
  return actor.kind === 'user' ? 'You' : 'System';
}

function ActorAvatar({ actor }: { readonly actor: ArtifactActor }) {
  if (actor.kind === 'agent') {
    return <AgentMark role={actor.role} roleName={actor.roleName} size="sm" />;
  }
  const Icon = actor.kind === 'user' ? User : Cpu;
  return (
    <span className="grid size-[26px] shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** `dependsOn` reads as "Depends on", `section:test_cases` as "Test cases". */
function fieldLabel(field: string): string {
  if (field.startsWith(SECTION_PREFIX)) {
    const section = field.slice(SECTION_PREFIX.length);
    return SECTION_LABELS[section as keyof typeof SECTION_LABELS] ?? section;
  }
  const words = field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value;
}

function Change({ change }: { readonly change: ArtifactFieldChange }) {
  return (
    <li className="flex flex-wrap items-baseline gap-1 text-[12.5px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{fieldLabel(change.field)}</span>
      {change.from !== undefined && change.from !== '' && <span className="line-through decoration-muted-foreground/50">{valueLabel(change.from)}</span>}
      {change.to !== undefined && change.to !== '' && (
        <>
          <span aria-hidden>→</span>
          <span className="text-foreground">{valueLabel(change.to)}</span>
        </>
      )}
    </li>
  );
}

function HistoryItem({ event, now }: { readonly event: ArtifactHistoryEvent; readonly now: number }) {
  return (
    <li className="group/item relative flex gap-3 pb-5 last:pb-0">
      <span aria-hidden className="absolute top-8 bottom-1 left-[12.5px] w-px bg-border group-last/item:hidden" />
      <ActorAvatar actor={event.actor} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">
          <span className="font-medium">{actorName(event.actor)}</span>
          {' '}
          <span className="text-muted-foreground">{event.summary}</span>
          <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="ml-2 text-xs text-muted-foreground/80">
            {formatRelativeTime(event.at, now)}
          </time>
        </p>
        {event.changes && event.changes.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {event.changes.map(change => <Change key={change.field} change={change} />)}
          </ul>
        )}
        {event.text && (
          <div className="rounded-xl rounded-tl-sm border bg-muted/40 px-3 py-2">
            <Markdown text={event.text} />
          </div>
        )}
      </div>
    </li>
  );
}

/** The comments and every change of an artifact, newest first, under a box to comment. */
export function ArtifactActivity({ history, onComment }: {
  readonly history: readonly ArtifactHistoryEvent[];
  readonly onComment: (text: string) => Promise<boolean>;
}) {
  const now = useNow(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    if (await onComment(text.trim())) {
      setText('');
    }
    setSending(false);
  };

  return (
    <section aria-labelledby="artifact-activity" className="flex flex-col gap-4">
      <h3 id="artifact-activity" className="font-heading text-sm font-semibold">Activity</h3>
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-2">
        <Textarea
          aria-label="Comment"
          placeholder="Add a note for the team. Agents read comments when they open this item."
          value={text}
          onChange={event => setText(event.target.value)}
          className="max-h-48 min-h-16"
        />
        <Button type="submit" size="sm" className="self-end" disabled={sending || text.trim() === ''}>Comment</Button>
      </form>
      <ol className="flex flex-col">
        {[...history].reverse().map(event => <HistoryItem key={event.id} event={event} now={now} />)}
      </ol>
    </section>
  );
}
