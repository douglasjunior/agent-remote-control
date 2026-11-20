import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { type AppHarness, openConversation, renderApp } from '../test/render-app.js';
import { squad } from '../test/squad-fixtures.js';


type User = ReturnType<typeof userEvent.setup>;

const AGENTS = [{ id: 'codex', name: 'Codex' }, { id: 'claude', name: 'Claude Code' }];

const pane = () => screen.getByRole('region', { name: 'Squad' });
const roleRow = (name: string) => within(within(pane()).getByRole('list', { name: 'Roles' })).getByRole('group', { name });
const sentOf = (app: AppHarness, type: string) => app.connection.sent.filter(command => command.type === type);

function emit(app: AppHarness, event: Parameters<AppHarness['connection']['emitEvent']>[0]) {
  act(() => app.connection.emitEvent(event));
}

async function pick(user: User, scope: HTMLElement, combobox: string, option: string) {
  await user.click(within(scope).getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

function openSquads(path = '/squads') {
  const app = renderApp(path);
  emit(app, { type: 'agents.list', agents: AGENTS });
  return { user: userEvent.setup(), ...app };
}

afterEach(() => {
  act(() => toast.dismiss());
});

describe('SquadsPage', () => {
  it('should ask for the squads and the agents once connected, and again after a reconnection', () => {
    const app = renderApp('/squads');

    expect(app.connection.sent).toContainEqual({ type: 'agents.list' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading squads…');
    act(() => app.connection.emitStatus('closed'));
    act(() => app.connection.emitStatus('open'));

    expect(sentOf(app, 'squads.list')).toHaveLength(2);
  });

  it('should list the squads by name, with the default marked and the roles each sets', () => {
    const app = openSquads();
    emit(app, {
      type: 'squads',
      squads: [
        squad({ isDefault: true, description: 'APIs and data' }),
        squad({ id: 's2', name: 'Frontend team', profiles: [] }),
      ],
    });

    const list = screen.getByRole('complementary', { name: 'Squads' });
    const backend = within(list).getByRole('link', { name: /Backend team/ });
    expect(backend).toHaveAttribute('href', '/squads/s1');
    expect(backend).toHaveTextContent('Default');
    expect(backend).toHaveTextContent('APIs and data');
    expect(within(backend).getByRole('list', { name: 'Sets' })).toHaveTextContent('CEO');
    expect(within(list).getByRole('link', { name: /Frontend team/ })).toHaveAttribute('href', '/squads/s2');
    expect(within(pane()).getByText('Pick a squad')).toBeInTheDocument();
  });

  it('should say how to start when there is no squad', () => {
    const app = openSquads();
    emit(app, { type: 'squads', squads: [] });

    expect(screen.getByText(/No squad yet/)).toBeInTheDocument();
  });

  it('should create a squad with the roles added to it, and open it once saved', async () => {
    const app = openSquads();
    const { user, router, connection } = app;
    emit(app, { type: 'squads', squads: [] });

    await user.click(screen.getByRole('link', { name: 'New squad' }));
    expect(router.state.location.pathname).toBe('/squads/new');
    expect(within(pane()).getByRole('heading', { name: 'New squad' })).toBeInTheDocument();
    expect(within(pane()).getByText('Product Owner')).toBeInTheDocument();
    const create = () => within(pane()).getByRole('button', { name: 'Create squad' });
    expect(create()).toBeDisabled();

    await user.type(within(pane()).getByRole('textbox', { name: 'Name' }), '  Backend team ');
    await user.type(within(pane()).getByRole('textbox', { name: 'Description' }), 'APIs');
    await user.click(within(pane()).getByRole('switch', { name: 'Default for new conversations' }));
    expect(create()).toBeDisabled();

    await user.click(within(pane()).getByRole('button', { name: 'Add QA' }));
    expect(within(pane()).getByText('Pick the agent, model and effort of every role in the squad.')).toBeInTheDocument();
    await pick(user, roleRow('QA'), 'Agent', 'Claude Code');
    emit(app, { type: 'models.list', agentId: 'claude', models: [] });
    await user.click(create());

    expect(connection.sent.at(-1)).toEqual({
      type: 'squads.save',
      name: 'Backend team',
      description: 'APIs',
      isDefault: true,
      profiles: { QA: { agentId: 'claude' } },
    });
    expect(within(pane()).getByRole('button', { name: 'Saving…' })).toBeDisabled();

    emit(app, { type: 'squads', squads: [squad({ id: 'other', name: 'Someone else' })] });
    expect(await screen.findByText('Backend team saved')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/squads/new');
  });

  it('should save the agent, model and effort picked for a role, once each list arrives', async () => {
    const app = openSquads('/squads/new');
    const { user, connection } = app;
    emit(app, { type: 'squads', squads: [] });

    await user.type(within(pane()).getByRole('textbox', { name: 'Name' }), 'Backend');
    await user.click(within(pane()).getByRole('button', { name: 'Add Developer' }));
    await pick(user, roleRow('Developer'), 'Agent', 'Codex');
    emit(app, { type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT' }] });
    await pick(user, roleRow('Developer'), 'Model', 'GPT');
    emit(app, { type: 'efforts.list', agentId: 'codex', modelId: 'gpt', efforts: [{ id: 'high', name: 'High' }] });
    await pick(user, roleRow('Developer'), 'Effort', 'High');
    await user.click(within(pane()).getByRole('button', { name: 'Create squad' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'squads.save',
      name: 'Backend',
      isDefault: false,
      profiles: { DEVELOPER: { agentId: 'codex', modelId: 'gpt', effortId: 'high' } },
    });
  });

  it('should open a squad it created once the list holds it, without the draft it started from', async () => {
    const app = openConversation();
    const { router, connection } = app;
    const user = userEvent.setup();
    emit(app, { type: 'agents.list', agents: AGENTS });
    await user.click(screen.getByRole('button', { name: 'Agent settings' }));
    await user.click(screen.getByRole('button', { name: 'Save as squad' }));
    emit(app, { type: 'squads', squads: [] });

    expect(within(roleRow('CEO')).getByRole('combobox', { name: 'Agent' })).toHaveTextContent('Codex');
    expect(within(pane()).getByRole('button', { name: 'Add Developer' })).toBeInTheDocument();
    emit(app, { type: 'models.list', agentId: 'codex', models: [] });
    await user.type(within(pane()).getByRole('textbox', { name: 'Name' }), 'Mine');
    await user.click(within(pane()).getByRole('button', { name: 'Create squad' }));
    expect(connection.sent.at(-1)).toEqual({ type: 'squads.save', name: 'Mine', isDefault: false, profiles: { CEO: { agentId: 'codex' } } });

    emit(app, { type: 'squads', squads: [squad({ id: 'mine', name: 'Mine' })] });

    expect(router.state.location.pathname).toBe('/squads/mine');
    expect(router.state.location.state).toEqual({ returnTo: '/c/c1' });
    await user.click(screen.getByRole('button', { name: 'Close squads' }));
    expect(router.state.location.pathname).toBe('/c/c1');
  });

  it('should change a squad, showing why the server refused a change in its editor only', async () => {
    const app = openSquads('/squads/s1');
    const { user, connection, router } = app;
    expect(within(pane()).getByRole('status')).toHaveTextContent('Loading…');
    emit(app, { type: 'squads', squads: [squad({ description: 'APIs', isDefault: true }), squad({ id: 's2', name: 'Frontend team' })] });

    expect(within(pane()).getByRole('heading', { name: 'Backend team' })).toBeInTheDocument();
    expect(within(pane()).getByRole('textbox', { name: 'Name' })).toHaveValue('Backend team');
    expect(within(pane()).getByRole('switch', { name: 'Default for new conversations' })).toBeChecked();
    expect(within(roleRow('CEO')).getByRole('combobox', { name: 'Agent' })).toHaveTextContent('Codex');
    expect(connection.sent).toContainEqual({ type: 'models.list', agentId: 'codex' });
    emit(app, { type: 'models.list', agentId: 'codex', models: [] });

    await user.clear(within(pane()).getByRole('textbox', { name: 'Name' }));
    await user.type(within(pane()).getByRole('textbox', { name: 'Name' }), 'Frontend team');
    await user.clear(within(pane()).getByRole('textbox', { name: 'Description' }));
    await user.click(within(pane()).getByRole('button', { name: 'Save squad' }));
    expect(connection.sent.at(-1)).toEqual({ type: 'squads.save', id: 's1', name: 'Frontend team', isDefault: true, profiles: { CEO: { agentId: 'codex' } } });

    emit(app, { type: 'error', message: 'Elsewhere', conversationId: 'c1' });
    expect(within(pane()).getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    emit(app, { type: 'error', message: 'Another squad is named "Frontend team"' });
    expect(within(pane()).getByRole('alert')).toHaveTextContent('Another squad is named "Frontend team"');
    emit(app, { type: 'error', message: 'Nobody waits for this' });
    expect(within(pane()).getByRole('alert')).toHaveTextContent('Another squad is named');

    await user.click(screen.getByRole('link', { name: /Frontend team/ }));
    expect(within(pane()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Backend team/ }));
    expect(within(pane()).getByRole('alert')).toBeInTheDocument();

    await user.clear(within(pane()).getByRole('textbox', { name: 'Name' }));
    await user.type(within(pane()).getByRole('textbox', { name: 'Name' }), 'Backend crew');
    await user.click(within(pane()).getByRole('button', { name: 'Save squad' }));
    emit(app, { type: 'squads', squads: [squad({ name: 'Backend crew' })] });

    expect(await screen.findByText('Backend crew saved')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/squads/s1');
    expect(within(pane()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should leave a role out of a squad, which then needs another role to be saved', async () => {
    const app = openSquads('/squads/s1');
    const { user } = app;
    emit(app, { type: 'squads', squads: [squad()] });
    emit(app, { type: 'models.list', agentId: 'codex', models: [] });
    expect(within(pane()).getByRole('button', { name: 'Save squad' })).toBeEnabled();

    await user.click(within(pane()).getByRole('button', { name: 'Leave CEO out' }));

    expect(within(pane()).getByRole('button', { name: 'Save squad' })).toBeDisabled();
    expect(within(pane()).getByRole('button', { name: 'Add CEO' })).toBeInTheDocument();
  });

  it('should offer the roles of a conversation the server described, and any other role the squad sets', async () => {
    const app = openConversation();
    await act(() => app.router.navigate('/squads/s1'));
    emit(app, { type: 'squads', squads: [squad({ profiles: [{ role: 'DESIGNER', roleName: 'Designer', agent: { id: 'codex', name: 'Codex', available: true } }] })] });

    const roles = within(within(pane()).getByRole('list', { name: 'Roles' })).getAllByRole('listitem');
    expect(roles.map(role => role.querySelector('p')?.textContent)).toEqual(['CEO', 'Developer', 'Designer']);
  });

  it('should delete a squad after a confirmation and return to the list', async () => {
    const app = openSquads('/squads/s1');
    const { user, connection, router } = app;
    emit(app, { type: 'squads', squads: [squad()] });

    await user.click(within(pane()).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete the squad Backend team?');
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(sentOf(app, 'squads.delete')).toHaveLength(0);

    await user.click(within(pane()).getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(connection.sent.at(-1)).toEqual({ type: 'squads.delete', id: 's1' });
    emit(app, { type: 'squads', squads: [] });

    expect(await screen.findByText('Backend team deleted')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/squads');
  });

  it('should tell why a squad was not deleted', async () => {
    const app = openSquads('/squads/s1');
    const { user } = app;
    emit(app, { type: 'squads', squads: [squad()] });

    await user.click(within(pane()).getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    emit(app, { type: 'error', message: 'Unknown squad' });

    expect(await screen.findByText('Unknown squad')).toBeInTheDocument();
    expect(app.router.state.location.pathname).toBe('/squads/s1');
  });

  it('should tell when the squad of the address does not exist', () => {
    const app = openSquads('/squads/gone');
    emit(app, { type: 'squads', squads: [squad()] });

    expect(within(pane()).getByText('This squad does not exist anymore.')).toBeInTheDocument();
  });

  it('should be reached from the settings page and close back to it', async () => {
    const app = openSquads('/settings?tab=squads');
    const { user, router } = app;

    await user.click(screen.getByRole('link', { name: /Squads/ }));
    expect(router.state.location.pathname).toBe('/squads');
    emit(app, { type: 'squads', squads: [squad()] });
    await user.click(screen.getByRole('link', { name: /Backend team/ }));
    await user.click(within(pane()).getByRole('link', { name: 'All squads' }));
    await user.click(screen.getByRole('button', { name: 'Close squads' }));

    expect(router.state.location.pathname + router.state.location.search).toBe('/settings?tab=squads');
  });

  it('should close to the start when it was opened from its address', async () => {
    const app = openSquads('/squads/s1');
    emit(app, { type: 'squads', squads: [squad()] });

    await app.user.click(within(pane()).getByRole('link', { name: 'All squads' }));
    await app.user.click(screen.getByRole('button', { name: 'Close squads' }));

    expect(app.router.state.location.pathname).toBe('/');
  });
});
