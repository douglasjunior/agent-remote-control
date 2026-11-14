import { ListTodo, MessagesSquare, PanelRightClose, PanelRightOpen, Pencil, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router';

import { boardPath } from '../artifacts/artifact-paths.js';
import { isClosed } from '../artifacts/artifact-tree.js';
import { useBoard } from '../artifacts/use-board.js';
import { useConnection } from '../connection/connection-context.js';
import { useConversations } from '../conversations/conversations-context.js';
import { emptyConversationView } from '../conversations/conversations-reducer.js';
import { openQuestion } from '../conversations/open-question.js';
import { deriveTeam } from '../conversations/team-state.js';
import { useDelivery } from '../conversations/use-delivery.js';
import { usePresence } from '../conversations/use-presence.js';
import { agentIdentity } from '../lib/agent-identity.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { useStoredFlag } from '../lib/use-stored-flag.js';
import { cn } from '../lib/utils.js';

import { AgentMark } from './agent/agent-mark.js';
import { ArtifactBoard } from './artifacts/artifact-board.js';
import { ArtifactPane } from './artifacts/artifact-pane.js';
import { Composer } from './composer.js';
import { AnswerInputProvider } from './entries/answer-input.js';
import { FeedList, type FeedHandle } from './entries/feed-list.js';
import type { QuestionAnswer } from './entries/question-card.js';
import { IconButton } from './icon-button.js';
import { SettingsSheet } from './settings-sheet.js';
import { SquadPanel } from './squad/squad-panel.js';
import { squadNeedsAttention, squadStatus } from './squad/squad-status.js';
import { TeamIntro } from './team-intro.js';
import { TitleInput } from './title-input.js';
import { Button } from './ui/button.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs.js';


/** Below this width the chat and the squad panel share the space as two tabs. */
const TABS_QUERY = '(max-width: 819px)';
const SQUAD_PANEL_ID = 'squad-panel';
const SQUAD_OPEN_KEY = 'arc.squadPanelOpen';

/** What the conversation column shows next to the squad panel: the chat, the mission board or one of its artifacts. */
export type ConversationPane =
  | { readonly kind: 'chat' }
  | { readonly kind: 'board' }
  | { readonly kind: 'artifact'; readonly artifactId: string };

function PaneLink({ to, label, icon, active, badge }: {
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-2.5 [&_svg]:size-3.5',
        active && 'bg-background text-foreground shadow-xs',
      )}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-muted-foreground/15 px-1.5 font-mono text-[10.5px] leading-4 tabular-nums" aria-label={`${badge} open`}>{badge}</span>
      )}
    </NavLink>
  );
}

export function ConversationView({ conversationId, pane = { kind: 'chat' } }: {
  readonly conversationId: string;
  readonly pane?: ConversationPane;
}) {
  const { connection, status } = useConnection();
  const { state, renameConversation } = useConversations();
  const [renaming, setRenaming] = useState(false);
  const { board } = useBoard(conversationId);
  const openTasks = Object.values(board.byId).filter(artifact => artifact.type === 'task' && !isClosed(artifact.status)).length;
  const view = state.byId[conversationId] ?? emptyConversationView;
  const title = state.list.find(item => item.id === conversationId)?.title ?? 'Conversation';
  const [settingsRequested, setSettingsRequested] = useState(false);
  const [settingsDismissed, setSettingsDismissed] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tab, setTab] = useState('chat');
  const feed = useRef<FeedHandle>(null);
  const tabbed = useMediaQuery(TABS_QUERY);
  const [panelOpen, setPanelOpen] = useStoredFlag(SQUAD_OPEN_KEY, true);
  const [suggestion, setSuggestion] = useState({ text: '', nonce: 0 });
  const noAgents = state.agents.length === 0;

  useEffect(() => {
    if (status !== 'open') {
      return;
    }
    connection.send({ type: 'conversation.history', conversationId });
    connection.send({ type: 'profiles.get', conversationId });
    connection.send({ type: 'artifacts.list', conversationId });
  }, [connection, status, conversationId]);

  useEffect(() => {
    if (status === 'open' && noAgents) {
      connection.send({ type: 'agents.list' });
    }
  }, [connection, status, noAgents]);

  const handleAnswer = (answer: QuestionAnswer) => {
    connection.send({ type: 'question.answer', conversationId, answer });
  };

  const handleContinue = (workId: string) => {
    connection.send({ type: 'work.resume', conversationId, workId });
  };

  const needsSettings = view.profilesLoaded && !view.configured && !settingsDismissed;
  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsRequested(open);
    if (!open) {
      setSettingsDismissed(true);
    }
  };

  const running = view.state !== 'idle';
  const entries = useMemo(() => view.entryIds.map(id => view.entries[id]), [view.entryIds, view.entries]);
  const questionId = useMemo(() => openQuestion(entries)?.id, [entries]);
  const team = useMemo(() => deriveTeam(entries, running, view.interrupted), [entries, running, view.interrupted]);
  usePresence(team);
  const delivery = useDelivery(entries, running);
  const toggleFocus = useCallback((role: string) => setFocus(current => (current === role ? null : role)), []);
  const selectStation = useCallback((role: string) => {
    toggleFocus(role);
    if (team.find(member => member.role === role)?.state !== 'waiting') {
      return;
    }
    setTab('chat');
    requestAnimationFrame(() => feed.current?.goToQuestion());
  }, [team, toggleFocus]);
  const attention = squadNeedsAttention(team);
  const focusedLabel = focus === null ? null : agentIdentity(focus, team.find(member => member.role === focus)?.roleName).label;

  const chat = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-[60px] items-center gap-3 border-b px-5 py-2">
        {renaming
          ? (
            <TitleInput
              title={title}
              label="Conversation title"
              onSave={next => renameConversation(conversationId, next)}
              onDone={() => setRenaming(false)}
              className="min-w-0 flex-1 font-heading text-[15px] font-semibold"
            />
          )
          : (
            <div className="group/title flex min-w-0 flex-1 items-center gap-1">
              <h2 className="min-w-0 truncate font-heading text-[17px] font-semibold">{title}</h2>
              <IconButton
                variant="ghost"
                size="icon-xs"
                label="Rename conversation"
                onClick={() => setRenaming(true)}
                className="shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <Pencil />
              </IconButton>
            </div>
          )}
        <nav aria-label="Conversation" className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
          <PaneLink to={`/c/${conversationId}`} label="Chat" icon={<MessagesSquare aria-hidden />} active={pane.kind === 'chat'} />
          <PaneLink to={boardPath(conversationId)} label="Tasks" icon={<ListTodo aria-hidden />} active={pane.kind !== 'chat'} badge={openTasks} />
        </nav>
        {focus !== null && (
          <button
            type="button"
            aria-label={`${focusedLabel} only, show everyone`}
            onClick={() => setFocus(null)}
            style={{ '--c': agentIdentity(focus).color } as CSSProperties}
            className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--c)_18%,transparent)] py-[5px] pr-[11px] pl-1.5 text-[13px] whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <AgentMark role={focus} size="sm" className="size-5" />
            {`${focusedLabel} only`}
            <span aria-hidden>×</span>
          </button>
        )}
        <Button variant="outline" size="sm" onClick={() => setSettingsRequested(true)}>
          <Settings />
          {' '}
          Settings
        </Button>
        {!tabbed && (
          <IconButton
            variant="ghost"
            label={panelOpen ? 'Hide squad panel' : `Show squad panel${attention ? ` (${squadStatus(team).text})` : ''}`}
            aria-expanded={panelOpen}
            aria-controls={SQUAD_PANEL_ID}
            className="relative"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            {!panelOpen && attention && (
              <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-attention motion-safe:animate-pulse" />
            )}
          </IconButton>
        )}
      </div>
      <div hidden={pane.kind !== 'chat'} className="flex min-h-0 flex-1 flex-col">
        {entries.length === 0 && !running && view.loaded
          ? <div className="min-h-0 flex-1"><TeamIntro onPick={text => setSuggestion(current => ({ text, nonce: current.nonce + 1 }))} /></div>
          : (
            <AnswerInputProvider conversationId={conversationId} questionId={questionId} onAnswer={handleAnswer}>
              <FeedList
                ref={feed}
                entries={entries}
                team={team}
                draft={view.draft}
                running={running}
                focus={focus}
                onFocus={toggleFocus}
                onHover={setHovered}
                onAnswer={handleAnswer}
              />
            </AnswerInputProvider>
          )}
        <Composer
          key={`${conversationId}:${suggestion.nonce}`}
          conversationId={conversationId}
          initialText={suggestion.text}
          disabled={status !== 'open' || !view.configured}
          running={running}
          onSend={(text, attachments) => connection.send({
            type: 'message.send',
            conversationId,
            text,
            ...(attachments.length > 0 && { attachments: [...attachments] }),
          })}
          onStop={() => connection.send({ type: 'turn.cancel', conversationId })}
        />
      </div>
      {pane.kind === 'board' && <div className="@container min-h-0 flex-1"><ArtifactBoard conversationId={conversationId} /></div>}
      {pane.kind === 'artifact' && <div className="min-h-0 flex-1"><ArtifactPane conversationId={conversationId} artifactId={pane.artifactId} /></div>}
    </div>
  );
  const squad = <SquadPanel members={team} focus={focus} highlight={hovered} delivery={delivery} onSelect={selectStation} onContinue={handleContinue} />;

  return (
    <div className="h-full">
      {tabbed
        ? (
          <Tabs value={tab} onValueChange={value => setTab(String(value))} className="h-full gap-0">
            <TabsList className="mx-4 my-2 w-auto self-stretch">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="squad">{squadStatus(team).tab}</TabsTrigger>
            </TabsList>
            <TabsContent value="chat" keepMounted className="min-h-0 flex-1 data-hidden:hidden">{chat}</TabsContent>
            <TabsContent value="squad" keepMounted className="min-h-0 flex-1 data-hidden:hidden">{squad}</TabsContent>
          </Tabs>
        )
        : (
          <div className="flex h-full">
            {chat}
            <aside id={SQUAD_PANEL_ID} hidden={!panelOpen} className="w-[420px] shrink-0 border-l">{squad}</aside>
          </div>
        )}
      <SettingsSheet conversationId={conversationId} open={settingsRequested || needsSettings} onOpenChange={handleSettingsOpenChange} />
    </div>
  );
}
