import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamMember } from '../../conversations/team-state.js';

import { SquadPanel } from './squad-panel.js';


const member = (role: string, state: TeamMember['state']): TeamMember => ({ role, roleName: role, state, steps: 0 });
const ROLES = ['CEO', 'PRODUCT_OWNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'GIT_OPS'];
const team = (working: readonly string[], ended: readonly string[] = []) => ROLES.map(role => member(role, working.includes(role) ? 'working' : ended.includes(role) ? 'done' : 'idle'));

const defaultMatchMedia = globalThis.matchMedia;

type Flight = { onfinish: (() => void) | null; oncancel: (() => void) | null };

describe('SquadPanel motion', () => {
  let flights: Flight[];

  beforeEach(() => {
    vi.useFakeTimers();
    flights = [];
    Element.prototype.animate = vi.fn(() => {
      const flight: Flight = { onfinish: null, oncancel: null };
      flights.push(flight);
      return flight;
    }) as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    vi.useRealTimers();
    vi.stubGlobal('matchMedia', defaultMatchMedia);
  });

  const panel = (members: readonly TeamMember[], delivery = 0) => <SquadPanel members={members} focus={null} highlight={null} delivery={delivery} onSelect={vi.fn()} onContinue={vi.fn()} />;
  const pulses = (container: HTMLElement) => container.querySelectorAll('.squad-pulse');

  it('sends a bigger pulse when an agent starts and repeats on an interval', () => {
    const { container } = render(panel(team(['DEVELOPER'])));
    expect(pulses(container)).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1150));
    expect(pulses(container)).toHaveLength(2);
  });

  it('removes each pulse when its flight ends or is cancelled', () => {
    const { container } = render(panel(team(['DEVELOPER', 'GIT_OPS'])));
    act(() => vi.advanceTimersByTime(1150));
    expect(pulses(container)).toHaveLength(4);

    flights.splice(0).forEach((flight, index) => (index % 2 === 0 ? flight.onfinish!() : flight.oncancel!()));
    expect(pulses(container)).toHaveLength(0);
  });

  it('keeps no more pulses than the ones in flight over a long session', () => {
    const { container } = render(panel(team(['DEVELOPER'])));
    for (let tick = 0; tick < 300; tick++) {
      act(() => vi.advanceTimersByTime(1150));
      flights.splice(0).forEach(flight => flight.onfinish!());
    }

    expect(pulses(container)).toHaveLength(0);
  });

  it('sends a pulse back to the coordinator when the agent ends, then stops the interval', () => {
    const { container, rerender } = render(panel(team(['DEVELOPER'])));
    flights.splice(0).forEach(flight => flight.onfinish!());

    rerender(panel(team([], ['DEVELOPER'])));
    expect(pulses(container)).toHaveLength(1);
    flights.splice(0).forEach(flight => flight.onfinish!());

    act(() => vi.advanceTimersByTime(5000));
    expect(pulses(container)).toHaveLength(0);
  });

  it('sends a pulse to every station on a delivery', () => {
    const { container, rerender } = render(panel(team([])));
    rerender(panel(team([]), 1));
    act(() => vi.advanceTimersByTime(1000));

    expect(pulses(container)).toHaveLength(6);
  });

  it('removes the pulses in flight when the panel unmounts', () => {
    const { container, unmount } = render(panel(team(['DEVELOPER'])));
    const host = container;
    unmount();

    expect(pulses(host)).toHaveLength(0);
  });

  it('sends nothing under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(panel(team(['DEVELOPER'])));

    expect(pulses(container)).toHaveLength(0);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it('sends nothing without the Web Animations API', () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const { container } = render(panel(team(['DEVELOPER'])));

    expect(pulses(container)).toHaveLength(0);
  });
});

describe('SquadPanel spine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('joins the first and last lens and stays neutral whatever the roles do', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = ROLES.indexOf(this.dataset.lens ?? '');
      return { top: index < 0 ? 0 : index * 100, height: index < 0 ? 0 : 36 } as DOMRect;
    });
    const { container } = render(<SquadPanel members={team(['GIT_OPS'])} focus={null} highlight={null} delivery={0} onSelect={vi.fn()} onContinue={vi.fn()} />);

    const spine = container.querySelector('.squad-spine') as HTMLElement;
    expect(spine.style.top).toBe('18px');
    expect(spine.style.height).toBe('500px');
    expect(container.querySelector('.squad-spine-lit')).toBeNull();
  });
});
