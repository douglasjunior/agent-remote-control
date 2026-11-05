import { useEffect, useRef, type RefObject } from 'react';

import type { TeamMember } from '../../conversations/team-state.js';
import { agentIdentity } from '../../lib/agent-identity.js';

import { lensCenter } from './lens-center.js';


const COORDINATOR = 'CEO';
const PULSE_INTERVAL_MS = 1150;
const DELIVERY_STAGGER_MS = 110;
const DELIVERY_MS = 1500;

function canAnimate(): boolean {
  return typeof Element.prototype.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function lensOf(container: Element, role: string): Element | undefined {
  return [...container.querySelectorAll<HTMLElement>('[data-lens]')].find(lens => lens.dataset.lens === role);
}

/** One light travelling along the spine between two lenses; the element removes itself when its flight ends. */
function sendPulse(container: Element, from: string, to: string, big: boolean) {
  const start = lensOf(container, from);
  const end = lensOf(container, to);
  if (!start || !end || !canAnimate()) {
    return;
  }
  const a = lensCenter(container, start);
  const b = lensCenter(container, end);
  const pulse = document.createElement('i');
  pulse.className = 'squad-pulse';
  pulse.style.setProperty('--c', agentIdentity(from === COORDINATOR ? to : from).color);
  container.append(pulse);
  const scale = big ? 1.35 : 1;
  const flight = pulse.animate(
    [
      { transform: `translateY(${a}px) scale(${scale})`, opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 1, offset: 0.85 },
      { transform: `translateY(${b}px) scale(${scale})`, opacity: 0 },
    ],
    { duration: 600 + Math.abs(b - a) * 0.6, easing: 'ease-in-out' },
  );
  flight.onfinish = () => pulse.remove();
  flight.oncancel = () => pulse.remove();
}

/**
 * The light on the spine. While an agent works, a pulse travels from the Coordinator to it on a repeating interval; a
 * bigger one goes out when it starts and one returns when it ends. A delivery sends one to every station and plays the
 * panel's one flare. Nothing runs under reduced motion or without the Web Animations API.
 */
export function useSquadMotion({ root, stations, members, delivery }: {
  readonly root: RefObject<HTMLElement | null>;
  readonly stations: RefObject<HTMLElement | null>;
  readonly members: readonly TeamMember[];
  readonly delivery: number;
}) {
  const workingKey = members.filter(member => member.state === 'working' && member.role !== COORDINATOR).map(member => member.role).join('|');
  const working = useRef<readonly string[]>([]);

  useEffect(() => {
    const container = stations.current!;
    const roles = workingKey === '' ? [] : workingKey.split('|');
    const before = working.current;
    working.current = roles;
    roles.filter(role => !before.includes(role)).forEach(role => sendPulse(container, COORDINATOR, role, true));
    before.filter(role => !roles.includes(role)).forEach(role => sendPulse(container, role, COORDINATOR, true));
    if (roles.length === 0) {
      return;
    }
    const timer = setInterval(() => roles.forEach(role => sendPulse(container, COORDINATOR, role, false)), PULSE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [stations, workingKey]);

  useEffect(() => {
    const container = stations.current;
    const panel = root.current;
    if (!container || !panel || delivery === 0) {
      return;
    }
    const roles = [...container.querySelectorAll<HTMLElement>('[data-lens]')].map(lens => lens.dataset.lens!);
    panel.setAttribute('data-delivered', 'true');
    const timers = roles.map((role, index) => setTimeout(() => sendPulse(container, COORDINATOR, role, true), index * DELIVERY_STAGGER_MS));
    timers.push(setTimeout(() => panel.removeAttribute('data-delivered'), DELIVERY_MS));
    return () => {
      timers.forEach(clearTimeout);
      panel.removeAttribute('data-delivered');
    };
  }, [root, stations, delivery]);

  useEffect(() => {
    const container = stations.current;
    return () => container?.querySelectorAll('.squad-pulse').forEach(pulse => pulse.remove());
  }, [stations]);
}
