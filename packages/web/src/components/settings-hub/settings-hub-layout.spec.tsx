import type { SettingView } from '@agent-remote-control/protocol/settings';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { openConversation, renderApp } from '../../test/render-app.js';
import { squad } from '../../test/squad-fixtures.js';
import { stubWideHub } from '../../test/wide-hub.js';


const SETTINGS: SettingView[] = [
  { key: 'USER_LANGUAGE', group: 'general', apply: 'live', envOnly: false, source: 'default', kind: 'text', value: 'English', defaultValue: 'English' },
  { key: 'DISCORD_ENABLED', group: 'discord', apply: 'live', envOnly: false, source: 'default', kind: 'boolean', value: true, defaultValue: true },
];

const SECTIONS = ['General', 'Agents', 'Squads', 'Skills', 'Discord', 'Advanced'];

const nav = () => screen.getByRole('navigation', { name: 'Settings sections' });
const section = (name: string) => within(nav()).getByRole('link', { name: new RegExp(`^${name}`) });
const path = (app: ReturnType<typeof renderApp>) => app.router.state.location.pathname;

afterEach(() => {
  act(() => toast.dismiss());
});

describe('SettingsHubLayout on a wide screen', () => {
  stubWideHub();

  it('should list the sections in order beside the open one, and open General for /settings', () => {
    const app = renderApp('/settings');

    expect(path(app)).toBe('/settings/general');
    expect(within(nav()).getAllByRole('link').map(link => link.textContent)).toEqual(SECTIONS);
    expect(section('General')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'General', level: 3 })).toBeInTheDocument();
  });

  it.each([
    ['General', '/settings/general'],
    ['Agents', '/settings/agents'],
    ['Squads', '/settings/squads'],
    ['Skills', '/settings/skills'],
    ['Discord', '/settings/discord'],
    ['Advanced', '/settings/advanced'],
  ])('should open %s on its own route, under the same header', async (name, route) => {
    const user = userEvent.setup();
    const app = renderApp('/settings/general');

    await user.click(section(name));

    expect(path(app)).toBe(route);
    expect(section(name)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name, level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/^(How the agents talk|Log in to the agent|Who runs each|What the agents read|The bot that|Origins, attachments)/)).toBeInTheDocument();
  });

  it.each([
    ['/settings/squads/new', 'Squads', 'New squad'],
    ['/settings/squads/s1', 'Squads', 'Backend team'],
    ['/settings/skills/api-testing', 'Skills', 'Loading…'],
  ])('should keep the nav on %s, inside its section', (route, name, content) => {
    const app = renderApp(route);
    act(() => app.connection.emitEvent({ type: 'squads', squads: [squad()] }));

    expect(section(name)).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText(content).length).toBeGreaterThan(0);
    expect(within(nav()).queryByRole('link', { name: /^Back/ })).not.toBeInTheDocument();
  });

  it.each([
    ['/skills', '/settings/skills'],
    ['/skills/api-testing', '/settings/skills/api-testing'],
    ['/squads', '/settings/squads'],
    ['/squads/new', '/settings/squads/new'],
    ['/squads/s1', '/settings/squads/s1'],
    ['/settings?tab=discord', '/settings/discord'],
    ['/settings?tab=squads', '/settings/squads'],
    ['/settings?tab=nowhere', '/settings/general'],
    ['/settings?tab=general', '/settings/general'],
  ])('should send the old address %s to %s', (from, to) => {
    const app = renderApp(from);

    expect(path(app)).toBe(to);
    expect(app.router.state.location.search).toBe('');
  });

  it('should keep where to return when it redirects an old address', async () => {
    const user = userEvent.setup();
    const app = openConversation();

    await act(() => app.router.navigate('/skills/api-testing', { state: { returnTo: '/c/c1' } }));
    expect(path(app)).toBe('/settings/skills/api-testing');
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(path(app)).toBe('/c/c1');
  });

  it('should close back to the page the hub was opened from, whichever section is open', async () => {
    const user = userEvent.setup();
    const app = openConversation();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(section('Advanced'));
    await user.click(section('Skills'));
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(path(app)).toBe('/c/c1');
  });

  it('should close to the start when it was opened from its address', async () => {
    const user = userEvent.setup();
    const app = renderApp('/settings/discord');

    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(path(app)).toBe('/');
  });

  it('should keep a draft while another section is open, show the save bar there and mark the section', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp('/settings/discord');
    act(() => connection.emitEvent({ type: 'settings', settings: SETTINGS }));

    await user.click(within(screen.getByRole('group', { name: 'Discord bot' })).getByRole('switch'));
    await user.click(section('Squads'));

    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(section('Discord')).toHaveAccessibleName('Discord (has unsaved changes)');
    expect(section('Squads')).toHaveAccessibleName('Squads');

    await user.click(section('Discord'));

    expect(within(screen.getByRole('group', { name: 'Discord bot' })).getByRole('switch')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(section('Discord')).toHaveAccessibleName('Discord');
    expect(screen.queryByText('1 unsaved change')).not.toBeInTheDocument();
  });
});

describe('SettingsHubLayout on a phone', () => {
  it('should show the section list alone for /settings, with no section open', () => {
    const app = renderApp('/settings');

    expect(path(app)).toBe('/settings');
    expect(within(nav()).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(SECTIONS.map(name => `/settings/${name.toLowerCase()}`));
    expect(within(nav()).getByRole('link', { name: /^Squads\s*Who runs each role/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('should open a section full screen with a Back to the list, and the list again from Back', async () => {
    const user = userEvent.setup();
    const app = renderApp('/settings');

    await user.click(within(nav()).getByRole('link', { name: /^Skills/ }));

    expect(path(app)).toBe('/settings/skills');
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Skills', level: 3 })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back' }));

    expect(path(app)).toBe('/settings');
    expect(nav()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('should give a detail route a Back to its section list, and not one to the section list of the hub', () => {
    const { connection } = renderApp('/settings/squads/new');
    act(() => connection.emitEvent({ type: 'squads', squads: [] }));

    expect(screen.getAllByRole('link', { name: 'Back' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings/squads');
  });

  it('should open the section an old address names, and the list from the bare path', () => {
    const app = renderApp('/settings?tab=advanced');

    expect(path(app)).toBe('/settings/advanced');
  });

  it('should keep going back to where the hub was opened from', async () => {
    const user = userEvent.setup();
    const app = openConversation();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(within(nav()).getByRole('link', { name: /^General/ }));
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(path(app)).toBe('/c/c1');
  });
});
