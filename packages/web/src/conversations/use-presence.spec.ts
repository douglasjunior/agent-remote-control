import { renderHook } from '@testing-library/react';

import type { TeamMember } from './team-state.js';
import { usePresence } from './use-presence.js';


const member = (role: string, state: TeamMember['state'], extra: Partial<TeamMember> = {}): TeamMember => ({ role, roleName: role, state, steps: 0, ...extra });

describe('usePresence', () => {
  beforeEach(() => {
    document.title = 'Agent Remote Control';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it.each([
    [[member('CEO', 'working')], '💭 Thinking…'],
    [[member('CEO', 'idle'), member('DEVELOPER', 'working')], '🛠 Developer working…'],
    [[member('DEVELOPER', 'working'), member('CODE_REVIEWER', 'working')], '🛠 2 agents working…'],
    [[member('DEVELOPER', 'working'), member('TECH_LEAD', 'waiting')], '❓ Needs your answer'],
  ])('titles the tab for %j', (members, title) => {
    renderHook(() => usePresence(members));

    expect(document.title).toBe(title);
  });

  it('leaves the title alone when nobody is active, and restores it afterwards', () => {
    const { rerender } = renderHook(({ members }) => usePresence(members), { initialProps: { members: [member('DEVELOPER', 'working')] } });
    expect(document.title).toBe('🛠 Developer working…');

    rerender({ members: [member('DEVELOPER', 'done')] });

    expect(document.title).toBe('Agent Remote Control');
  });

  it('tints the page light with the color of the agent at work and clears it afterwards', () => {
    const { unmount } = renderHook(() => usePresence([member('DEVELOPER', 'working')]));
    expect(document.documentElement.style.getPropertyValue('--glow-color')).toBe('var(--agent-developer)');

    unmount();

    expect(document.documentElement.style.getPropertyValue('--glow-color')).toBe('');
  });

  it('keeps the page light untouched when nobody is active', () => {
    renderHook(() => usePresence([member('DEVELOPER', 'done')]));

    expect(document.documentElement.style.getPropertyValue('--glow-color')).toBe('');
  });

  describe('notification', () => {
    const notify = vi.fn();

    beforeEach(() => {
      notify.mockClear();
      class FakeNotification {
        static permission = 'granted';
        constructor(title: string, options: NotificationOptions) {
          notify(title, options);
        }
      }
      vi.stubGlobal('Notification', FakeNotification);
    });

    it('announces a question while the tab is hidden', () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });

      renderHook(() => usePresence([member('TECH_LEAD', 'waiting', { summary: 'Planning the login' })]));

      expect(notify).toHaveBeenCalledWith('Needs your answer', { body: 'Planning the login' });
    });

    it('names the asker when there is no summary', () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });

      renderHook(() => usePresence([member('CEO', 'waiting')]));

      expect(notify).toHaveBeenCalledWith('Needs your answer', { body: 'Coordinator' });
    });

    it('stays quiet while the tab is visible, when nobody asks and when notifications are not allowed', () => {
      renderHook(() => usePresence([member('TECH_LEAD', 'waiting')]));
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      renderHook(() => usePresence([member('TECH_LEAD', 'working')]));
      vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default' }));
      renderHook(() => usePresence([member('TECH_LEAD', 'waiting')]));

      expect(notify).not.toHaveBeenCalled();
    });

    it('stays quiet where notifications do not exist', () => {
      vi.stubGlobal('Notification', undefined);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });

      expect(() => renderHook(() => usePresence([member('TECH_LEAD', 'waiting')]))).not.toThrow();
    });
  });
});
