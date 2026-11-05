import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AT, openConversation, userEntry } from '../test/render-app.js';


const delegation = (id: string, role: string, roleName: string, summary: string, phase: 'started' | 'finished' = 'started'): ConversationEntry => ({
  id, at: AT, type: 'delegation', delegationId: role, phase, round: 1, role, roleName, summary, ...(phase === 'finished' ? { durationMs: 3000 } : {}),
});
const answer: ConversationEntry = { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'All finished' };
const interim: ConversationEntry = { id: 'i1', at: AT, type: 'interim', text: 'Briefing the team' };

const squad = () => screen.getByRole('region', { name: 'Your squad', hidden: true });
const setState = (connection: ReturnType<typeof openConversation>['connection'], state: 'running' | 'idle') => act(() => connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state }));
const defaultMatchMedia = globalThis.matchMedia;

describe('ConversationView squad', () => {
  afterEach(() => {
    vi.stubGlobal('matchMedia', defaultMatchMedia);
    vi.restoreAllMocks();
  });

  it('shows the chat and the squad panel side by side on a wide window', () => {
    openConversation();

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(squad()).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('turns chat and squad into two tabs on a narrow window, the Squad tab carrying the tally', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = userEvent.setup();
    const { connection } = openConversation({ entries: [userEntry('u1'), delegation('d1', 'DEVELOPER', 'Developer', 'Build it')] });
    setState(connection, 'running');

    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Squad · 1 working' })).toBeInTheDocument();
    expect(squad()).not.toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Squad · 1 working' }));
    expect(squad()).toBeVisible();
  });

  it('continues an agent a restart stopped from its station', async () => {
    const user = userEvent.setup();
    const { connection } = openConversation({ entries: [userEntry('u1'), delegation('d1', 'DEVELOPER', 'Developer', 'Build it')] });
    const send = vi.spyOn(connection, 'send');
    act(() => connection.emitEvent({
      type: 'conversation.interrupted',
      conversationId: 'c1',
      interrupted: [{ id: 'w', role: 'DEVELOPER', roleName: 'Developer', projectName: null, summary: 'Build it' }],
    }));

    await user.click(within(squad()).getByRole('button', { name: /^Continue/ }));

    expect(send).toHaveBeenCalledWith({ type: 'work.resume', conversationId: 'c1', workId: 'w' });
  });

  describe('waiting station', () => {
    const question: ConversationEntry = {
      id: 'q1', at: AT, type: 'question', askerRole: 'DEVELOPER', askerRoleName: 'Developer', text: 'Which branch?', options: ['main'], number: 1, total: 1, closed: false,
    };
    const entries = [userEntry('u1'), delegation('d1', 'DEVELOPER', 'Developer', 'Build it'), question, userEntry('u2')];

    it('takes the reader to the open question and focuses its first control, besides selecting the station', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation({ entries });
      setState(connection, 'running');

      await user.click(within(squad()).getByRole('button', { name: /Developer/ }));

      expect(screen.getByRole('button', { name: 'main' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Developer only, show everyone' })).toBeInTheDocument();
    });

    it('leaves the focus alone when the clicked station is not waiting', async () => {
      const user = userEvent.setup();
      const { connection } = openConversation({ entries });
      setState(connection, 'running');

      await user.click(within(squad()).getByRole('button', { name: /Git Ops/ }));

      expect(screen.getByRole('button', { name: 'main' })).not.toHaveFocus();
    });

    it('switches to the chat tab of a narrow window first', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 0;
      });
      const user = userEvent.setup();
      const { connection } = openConversation({ entries });
      setState(connection, 'running');
      await user.click(screen.getByRole('tab', { name: /Squad/ }));

      await user.click(within(squad()).getByRole('button', { name: /Developer/ }));

      expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('focuses an agent from its station, dims the others, and clears from the chip', async () => {
    const user = userEvent.setup();
    openConversation({ entries: [userEntry('u1'), interim, delegation('d1', 'DEVELOPER', 'Developer', 'Build it'), delegation('d2', 'GIT_OPS', 'Git Ops', 'Ship it')] });
    const feed = within(screen.getByTestId('message-viewport'));
    const dimmed = (text: string) => feed.getByText(text).closest('[data-dimmed]')!.getAttribute('data-dimmed');

    await user.click(within(squad()).getByRole('button', { name: /Developer/ }));

    expect(dimmed('Briefing the team')).toBe('true');
    expect(dimmed('Ship it')).toBe('true');
    expect(dimmed('Build it')).toBe('false');
    expect(dimmed('u1')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Developer only, show everyone' }));

    expect(screen.queryByRole('button', { name: /only, show everyone/ })).not.toBeInTheDocument();
    expect(dimmed('Briefing the team')).toBe('false');
  });

  it('focuses the coordinator by clicking its name in the feed, and toggles it off', async () => {
    const user = userEvent.setup();
    openConversation({ entries: [userEntry('u1'), interim] });

    await user.click(screen.getByRole('button', { name: 'Show only Coordinator' }));
    expect(screen.getByRole('button', { name: 'Coordinator only, show everyone' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show only Coordinator' }));
    expect(screen.queryByRole('button', { name: /only, show everyone/ })).not.toBeInTheDocument();
  });

  it('forgets the focus when another conversation opens', async () => {
    const user = userEvent.setup();
    const { router } = openConversation({ entries: [userEntry('u1'), interim] });
    await user.click(screen.getByRole('button', { name: 'Show only Coordinator' }));

    await act(() => router.navigate('/c/c2'));

    expect(screen.queryByRole('button', { name: /only, show everyone/ })).not.toBeInTheDocument();
  });

  it('highlights the station of the feed item under the pointer', async () => {
    const user = userEvent.setup();
    openConversation({ entries: [userEntry('u1'), interim] });
    const coordinator = within(squad()).getByRole('button', { name: /Coordinator/ });
    expect(coordinator.className).not.toContain('_14%');

    await user.hover(screen.getByText('Briefing the team'));
    expect(coordinator.className).toContain('_14%');

    await user.unhover(screen.getByText('Briefing the team'));
    expect(coordinator.className).not.toContain('_14%');
  });

  it('plays the delivery moment when a running turn that delegated ends with its answer', () => {
    const { connection } = openConversation({ entries: [userEntry('u1'), delegation('d1', 'DEVELOPER', 'Developer', 'Build it')] });
    setState(connection, 'running');
    act(() => connection.emitEvent({ type: 'conversation.entry', conversationId: 'c1', entry: answer }));
    expect(squad()).not.toHaveAttribute('data-delivered');

    setState(connection, 'idle');
    expect(squad()).toHaveAttribute('data-delivered', 'true');
  });

  it('does not play the delivery moment when an old conversation is opened', () => {
    openConversation({ entries: [userEntry('u1'), delegation('d1', 'DEVELOPER', 'Developer', 'Build it', 'finished'), answer] });

    expect(squad()).not.toHaveAttribute('data-delivered');
  });
});
