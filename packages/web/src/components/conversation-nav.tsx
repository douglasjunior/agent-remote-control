import { ListTodo, MessagesSquare, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { boardPath } from '../artifacts/artifact-paths.js';
import { conversationPath, squadPath } from '../conversations/conversation-paths.js';
import { cn } from '../lib/utils.js';


type ConversationSection = 'chat' | 'tasks' | 'squad';

/** The Squad link of a narrow window: how many agents work, and whether one needs the user. */
type SquadLink = {
  readonly working: number;
  readonly attention: boolean;
  /** Read after the label by assistive technology, e.g. "1 working · needs your answer". */
  readonly description?: string;
};

function SectionLink({ to, label, icon, active, fill, children, description }: {
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly fill: boolean;
  readonly children?: ReactNode;
  readonly description?: string;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0',
        fill && 'h-8 min-w-0 flex-1 px-2',
        active && 'bg-background text-foreground shadow-xs',
      )}
    >
      {icon}
      {label}
      {children}
      {description && <span className="sr-only">{`, ${description}`}</span>}
    </Link>
  );
}

function Count({ value }: { readonly value: number }) {
  return <span aria-hidden className="rounded-full bg-muted-foreground/15 px-1.5 font-mono text-[10.5px] leading-4 tabular-nums">{value}</span>;
}

/**
 * The sections of a conversation as links, the current one raised. A wide window leaves Squad out, since the squad is
 * its side panel there; a narrow one passes `squad` and `fill` to spread the three links over the width.
 */
export function ConversationNav({ conversationId, active, openTasks, squad, fill = false, className }: {
  readonly conversationId: string;
  readonly active: ConversationSection;
  readonly openTasks: number;
  readonly squad?: SquadLink;
  readonly fill?: boolean;
  readonly className?: string;
}) {
  return (
    <nav aria-label="Conversation" className={cn('inline-flex shrink-0 rounded-lg bg-muted p-0.5', fill && 'flex w-full', className)}>
      <SectionLink to={conversationPath(conversationId)} label="Chat" icon={<MessagesSquare aria-hidden />} active={active === 'chat'} fill={fill} />
      <SectionLink
        to={boardPath(conversationId)}
        label="Tasks"
        icon={<ListTodo aria-hidden />}
        active={active === 'tasks'}
        fill={fill}
        description={openTasks > 0 ? `${openTasks} open` : undefined}
      >
        {openTasks > 0 && <Count value={openTasks} />}
      </SectionLink>
      {squad && (
        <SectionLink
          to={squadPath(conversationId)}
          label="Squad"
          icon={<UsersRound aria-hidden />}
          active={active === 'squad'}
          fill={fill}
          description={squad.description}
        >
          {squad.working > 0 && <Count value={squad.working} />}
          {squad.attention && active !== 'squad' && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention motion-safe:animate-pulse" />}
        </SectionLink>
      )}
    </nav>
  );
}
