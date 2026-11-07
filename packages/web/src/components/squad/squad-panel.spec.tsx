import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveTeam } from '../../conversations/team-state.js';

import { SquadPanel } from './squad-panel.js';


const AT = '2026-01-01T00:00:00.000Z';

const user = (id: string): ConversationEntry => ({ id, at: AT, type: 'user_message', text: id });
const started = (id: string, role: string, roleName: string, summary = 'Do the work'): ConversationEntry => ({
  id, at: AT, type: 'delegation', delegationId: role, phase: 'started', round: 1, role, roleName, prompt: 'Do the work', summary,
});
const finished = (id: string, role: string, roleName: string, phase: 'finished' | 'failed' = 'finished'): ConversationEntry => ({
  id, at: AT, type: 'delegation', delegationId: role, phase, round: 1, role, roleName, prompt: 'Do the work', summary: 'Do the work', durationMs: 4000,
});

function renderPanel(entries: readonly ConversationEntry[], running: boolean, props: Partial<Parameters<typeof SquadPanel>[0]> = {}) {
  const members = deriveTeam(entries, running);
  return render(<SquadPanel members={members} focus={null} highlight={null} delivery={0} onSelect={vi.fn()} onContinue={vi.fn()} {...props} />);
}

const station = (name: RegExp) => screen.getByRole('button', { name });
const stationStates = () => screen.getAllByRole('button').map(button => [button.dataset.role, button.dataset.state]);

describe('SquadPanel', () => {
  afterEach(() => vi.useRealTimers());

  it('shows one station per role of the team and is ready when nothing runs', () => {
    renderPanel([], false);

    expect(screen.getByRole('heading', { name: 'Your squad' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(stationStates().every(([, state]) => state === 'idle')).toBe(true);
  });

  it('keeps the same size however many delegations the conversation accumulates', () => {
    const turn = (index: number): ConversationEntry[] => [
      user(`u${index}`),
      started(`s${index}`, 'DEVELOPER', 'Developer'),
      finished(`f${index}`, 'DEVELOPER', 'Developer'),
    ];
    const one = renderPanel(turn(0), false);
    const small = one.container.innerHTML;
    one.unmount();

    const many = renderPanel(Array.from({ length: 200 }, (_, index) => turn(index)).flat(), false);

    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(many.container.querySelectorAll('li')).toHaveLength(6);
    expect(many.container.innerHTML).toBe(small);
  });

  it('adds a station only for an unknown role delegated to in the current turn', () => {
    renderPanel([user('u1'), started('s1', 'DESIGNER', 'Designer')], true);

    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(station(/Designer/)).toHaveAttribute('data-state', 'working');
  });

  it('starts from a clean panel on each new user message', () => {
    renderPanel([user('u1'), started('s1', 'DEVELOPER', 'Developer'), finished('f1', 'DEVELOPER', 'Developer'), user('u2')], true);

    expect(stationStates()).toEqual([['CEO', 'working'], ['PRODUCT_OWNER', 'idle'], ['TECH_LEAD', 'idle'], ['DEVELOPER', 'idle'], ['CODE_REVIEWER', 'idle'], ['GIT_OPS', 'idle']]);
  });

  it('leaves every station the turn did not involve idle when it delegates only to Git Ops', () => {
    renderPanel([user('u1'), started('s1', 'GIT_OPS', 'Git Ops', 'Open the pull request')], true);

    expect(stationStates()).toEqual([['CEO', 'working'], ['PRODUCT_OWNER', 'idle'], ['TECH_LEAD', 'idle'], ['DEVELOPER', 'idle'], ['CODE_REVIEWER', 'idle'], ['GIT_OPS', 'working']]);
    expect(station(/Git Ops/)).toHaveTextContent('Open the pull request');
    expect(station(/Product Owner/)).toHaveTextContent('Figures out what to build');
    expect(screen.getByText('1 working')).toBeInTheDocument();
  });

  it('reads Coordinating the squad while delegates work and Thinking when it works itself', () => {
    const delegating = renderPanel([user('u1'), started('s1', 'DEVELOPER', 'Developer')], true);
    expect(station(/Coordinator/)).toHaveTextContent('Coordinating the squad');
    expect(station(/Coordinator/)).toHaveAttribute('data-state', 'working');
    delegating.unmount();

    renderPanel([user('u1')], true);
    expect(station(/Coordinator/)).toHaveTextContent('Thinking');
  });

  it('shows the latest action as one ticker line, and finished work with its duration', () => {
    const entries: ConversationEntry[] = [
      user('u1'),
      started('s1', 'DEVELOPER', 'Developer'),
      { id: 't1', at: AT, type: 'tool', role: 'DEVELOPER', title: 'Read file', status: 'completed' },
      started('s2', 'GIT_OPS', 'Git Ops'),
      finished('f2', 'GIT_OPS', 'Git Ops'),
    ];
    renderPanel(entries, true);

    expect(within(station(/Developer/)).getByText('Reading files')).toBeInTheDocument();
    expect(station(/Git Ops/)).toHaveAttribute('data-state', 'done');
    expect(station(/Git Ops/)).toHaveTextContent('4 s');
  });

  it('marks the asker as waiting for the user', () => {
    renderPanel([
      user('u1'),
      { id: 'q1', at: AT, type: 'question', askerRole: 'PRODUCT_OWNER', askerRoleName: 'Product Owner', text: 'Which?', options: [], number: 1, total: 1, closed: false },
    ], true);

    expect(station(/Product Owner/)).toHaveTextContent('Waiting for your answer');
    expect(screen.getByText('needs your answer')).toBeInTheDocument();
  });

  it('shows a failed delegation and a failed coordinator', () => {
    renderPanel([
      user('u1'),
      started('s1', 'DEVELOPER', 'Developer'),
      finished('f1', 'DEVELOPER', 'Developer', 'failed'),
      { id: 'r1', at: AT, type: 'agent_response', status: 'failed', response: '' },
    ], false);

    expect(station(/Developer/)).toHaveTextContent('Failed');
    expect(station(/Coordinator/)).toHaveTextContent('Hit a problem');
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('describes a delivered turn', () => {
    renderPanel([user('u1'), { id: 'r1', at: AT, type: 'agent_response', status: 'completed', response: 'done' }], false);

    expect(station(/Coordinator/)).toHaveTextContent('Answer delivered');
    expect(screen.getAllByText('Answer delivered')).toHaveLength(2);
  });

  it('reveals only the static responsibility of the selected station', async () => {
    const onSelect = vi.fn();
    const { rerender } = renderPanel([], false, { onSelect });
    expect(screen.queryByText('Responsibility')).not.toBeInTheDocument();

    await userEvent.setup().click(station(/Developer/));
    expect(onSelect).toHaveBeenCalledWith('DEVELOPER');

    rerender(<SquadPanel members={deriveTeam([], false)} focus="DEVELOPER" highlight="GIT_OPS" delivery={0} onSelect={onSelect} onContinue={vi.fn()} />);
    expect(screen.getAllByText('Responsibility')).toHaveLength(1);
    expect(station(/Developer/)).toHaveAttribute('aria-pressed', 'true');
    expect(station(/Developer/)).toHaveTextContent('Builds the plan, writes the tests, and fixes what the review finds.');
    expect(station(/Git Ops/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('plays the delivery moment once per delivery and then clears it', () => {
    vi.useFakeTimers();
    const members = deriveTeam([], false);
    const { rerender, container } = render(<SquadPanel members={members} focus={null} highlight={null} delivery={0} onSelect={vi.fn()} onContinue={vi.fn()} />);
    const panel = container.querySelector('.squad-panel') as HTMLElement;
    expect(panel).not.toHaveAttribute('data-delivered');

    rerender(<SquadPanel members={members} focus={null} highlight={null} delivery={1} onSelect={vi.fn()} onContinue={vi.fn()} />);
    expect(panel).toHaveAttribute('data-delivered', 'true');

    act(() => vi.advanceTimersByTime(1500));
    expect(panel).not.toHaveAttribute('data-delivered');
  });

  it('ticks the clock of an agent that works', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AT).getTime());
    renderPanel([user('u1'), started('s1', 'DEVELOPER', 'Developer')], true);
    expect(station(/Developer/)).toHaveTextContent('0 s');

    act(() => vi.advanceTimersByTime(5000));
    expect(station(/Developer/)).toHaveTextContent('5 s');
  });

  it('offers to continue an agent a restart stopped', async () => {
    const onContinue = vi.fn();
    const work = { id: 'w', role: 'DEVELOPER', roleName: 'Developer', projectName: 'app', summary: 'Build the form' };
    render(<SquadPanel members={deriveTeam([started('s', 'DEVELOPER', 'Developer')], false, [work])} focus={null} highlight={null} delivery={0} onSelect={vi.fn()} onContinue={onContinue} />);

    expect(screen.getByText('Interrupted unexpectedly')).toBeInTheDocument();
    expect(screen.getByText('1 stopped')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Continue/ }));

    expect(onContinue).toHaveBeenCalledWith('w');
  });
});
