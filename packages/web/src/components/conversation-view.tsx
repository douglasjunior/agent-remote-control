import { PanelRightClose, PanelRightOpen, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';

import { isClosed } from '../artifacts/artifact-tree.js';
import { useBoard } from '../artifacts/use-board.js';
import { useConnection } from '../connection/connection-context.js';
import { conversationPath } from '../conversations/conversation-paths.js';
import { useConversations } from '../conversations/conversations-context.js';
import { emptyConversationView } from '../conversations/conversations-reducer.js';
import { openQuestion } from '../conversations/open-question.js';
import { deriveTeam } from '../conversations/team-state.js';
import { useDelivery } from '../conversations/use-delivery.js';
import { useEarlierEntries } from '../conversations/use-earlier-entries.js';
import { usePresence } from '../conversations/use-presence.js';
import { agentIdentity } from '../lib/agent-identity.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { useStoredFlag } from '../lib/use-stored-flag.js';
import { cn } from '../lib/utils.js';

import { AgentMark } from './agent/agent-mark.js';
import { ArtifactBoard } from './artifacts/artifact-board.js';
import { ArtifactPane } from './artifacts/artifact-pane.js';
import { Composer } from './composer.js';
import { ConversationNav } from './conversation-nav.js';
import { AnswerInputProvider } from './entries/answer-input.js';
import { FeedList, type FeedHandle } from './entries/feed-list.js';
import type { QuestionAnswer } from './entries/question-card.js';
import { IconButton } from './icon-button.js';
import { SettingsSheet } from './settings-sheet.js';
import { SquadPanel } from './squad/squad-panel.js';
import { squadNeedsAttention, squadStatus } from './squad/squad-status.js';
import { TeamIntro } from './team-intro.js';
import { TitleInput } from './title-input.js';


/** Below this width the conversation shows one section at a time (chat, tasks or squad) and the squad has no side panel. */
const COMPACT_QUERY = '(max-width: 819px)';
const SQUAD_PANEL_ID = 'squad-panel';
const SQUAD_OPEN_KEY = 'arc.squadPanelOpen';

/**
 * The section of the conversation the route asks for: the chat, the mission board, one of its artifacts or the squad,
 * which a wide window shows as its side panel next to the chat.
 */
export type ConversationPane =
  | { readonly kind: 'chat' }
  | { readonly kind: 'board' }
  | { readonly kind: 'artifact'; readonly artifactId: string }
  | { readonly kind: 'squad' };

export function ConversationView({ conversationId, pane = { kind: 'chat' }, initialPrompt = '' }: {
  readonly conversationId: string;
  readonly pane?: ConversationPane;
  /** Text the composer starts with, for the user to finish and send. */
  readonly initialPrompt?: string;
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
  const feed = useRef<FeedHandle>(null);
  const questionPending = useRef(false);
  const navigate = useNavigate();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [panelOpen, setPanelOpen] = useStoredFlag(SQUAD_OPEN_KEY, true);
  const squadPane = pane.kind === 'squad' && compact;
  const chatShown = pane.kind === 'chat' || (pane.kind === 'squad' && !compact);
  const [suggestion, setSuggestion] = useState({ text: initialPrompt, nonce: 0 });
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

  /** A squad saved or deleted may change whether this conversation's profiles still match the squad it applied. */
  useEffect(() => connection.onEvent((event) => {
    if (event.type === 'squads') {
      connection.send({ type: 'profiles.get', conversationId });
    }
  }), [connection, conversationId]);

  useEffect(() => {
    if (pane.kind === 'squad' && !compact) {
      setPanelOpen(true);
      void navigate(conversationPath(conversationId), { replace: true });
    }
  }, [pane.kind, compact, setPanelOpen, navigate, conversationId]);

  // The feed can only scroll to the question once the chat it lives in is shown.
  useEffect(() => {
    if (chatShown && questionPending.current) {
      questionPending.current = false;
      requestAnimationFrame(() => feed.current?.goToQuestion());
    }
  }, [chatShown]);

  const handleAnswer = (answer: QuestionAnswer) => {
    connection.send({ type: 'question.answer', conversationId, answer });
  };

  const handleRetryNow = () => {
    connection.send({ type: 'retry.now', conversationId });
  };

  const handleStopRetrying = () => {
    connection.send({ type: 'retry.stop', conversationId });
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
  const earlier = useEarlierEntries(conversationId, view);
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
    if (chatShown) {
      requestAnimationFrame(() => feed.current?.goToQuestion());
    } else {
      questionPending.current = true;
      void navigate(conversationPath(conversationId));
    }
  }, [team, toggleFocus, chatShown, navigate, conversationId]);
  const attention = squadNeedsAttention(team);
  const tally = squadStatus(team);
  const focusedLabel = focus === null ? null : agentIdentity(focus, team.find(member => member.role === focus)?.roleName).label;

  const section = pane.kind === 'board' || pane.kind === 'artifact' ? 'tasks' : squadPane ? 'squad' : 'chat';
  const header = (
    <div className={cn('flex items-center gap-3 border-b py-2', compact ? 'min-h-[52px] px-4' : 'min-h-[60px] px-5')}>
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
      {!compact && <ConversationNav conversationId={conversationId} active={section} openTasks={openTasks} />}
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
      {!compact && (
        <IconButton
          variant="ghost"
          label={panelOpen ? 'Hide squad panel' : `Show squad panel${attention ? ` (${tally.text})` : ''}`}
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
  );
  const panes = (
    <>
      <div hidden={!chatShown} className="flex min-h-0 flex-1 flex-col">
        {entries.length === 0 && !running && view.loaded
          ? <div className="min-h-0 flex-1"><TeamIntro onPick={text => setSuggestion(current => ({ text, nonce: current.nonce + 1 }))} /></div>
          : (
            <AnswerInputProvider conversationId={conversationId} questionId={questionId} onAnswer={handleAnswer}>
              <FeedList
                ref={feed}
                entries={entries}
                earlier={earlier}
                team={team}
                draft={view.draft}
                running={running}
                stateAfter={view.stateAfter}
                focus={focus}
                onFocus={toggleFocus}
                onHover={setHovered}
                onAnswer={handleAnswer}
                onRetryNow={handleRetryNow}
                onStopRetrying={handleStopRetrying}
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
      {pane.kind === 'board' && <div className="min-h-0 flex-1"><ArtifactBoard conversationId={conversationId} /></div>}
      {pane.kind === 'artifact' && <div className="min-h-0 flex-1"><ArtifactPane conversationId={conversationId} artifactId={pane.artifactId} /></div>}
    </>
  );
  const squad = <SquadPanel members={team} profiles={view.profiles} focus={focus} highlight={hovered} delivery={delivery} onSelect={selectStation} onContinue={handleContinue} onSettings={() => setSettingsRequested(true)} />;

  return (
    <div className="h-full">
      {compact
        ? (
          <div className="flex h-full min-w-0 flex-col">
            {header}
            <div className="border-b px-3 py-2">
              <ConversationNav
                conversationId={conversationId}
                active={section}
                openTasks={openTasks}
                squad={{ working: tally.working, attention, description: tally.live || attention ? tally.text : undefined }}
                fill
              />
            </div>
            {panes}
            <div hidden={!squadPane} className="min-h-0 flex-1">{squad}</div>
          </div>
        )
        : (
          <div className="flex h-full">
            <div className="flex h-full min-w-0 flex-1 flex-col">
              {header}
              {panes}
            </div>
            <aside id={SQUAD_PANEL_ID} hidden={!panelOpen} className="w-[420px] shrink-0 border-l">{squad}</aside>
          </div>
        )}
      <SettingsSheet conversationId={conversationId} open={settingsRequested || needsSettings} onOpenChange={handleSettingsOpenChange} />
    </div>
  );
}
