import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { openConversation, roleProfiles, type AppHarness } from '../test/render-app.js';
import { squad } from '../test/squad-fixtures.js';


type User = ReturnType<typeof userEvent.setup>;

async function openSettings(options: { configured?: boolean } = {}) {
  const user = userEvent.setup();
  const app = openConversation(options);
  emit(app, {
    type: 'agents.list',
    agents: [{ id: 'codex', name: 'Codex' }, { id: 'claude', name: 'Claude Code' }],
  });
  if (options.configured !== false) {
    await user.click(screen.getByRole('button', { name: 'Agent settings' }));
  }
  return { user, ...app };
}

const dialog = () => screen.getByRole('dialog', { name: 'Settings' });
const editor = (name: string) => within(dialog()).getByRole('group', { name });

function emit(app: AppHarness, event: Parameters<AppHarness['connection']['emitEvent']>[0]) {
  act(() => app.connection.emitEvent(event));
}

async function pick(user: User, scope: HTMLElement, combobox: string, option: string) {
  await user.click(within(scope).getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const sentOf = (app: AppHarness, type: string) => app.connection.sent.filter(command => command.type === type);

afterEach(() => {
  act(() => toast.dismiss());
});

describe('SettingsSheet', () => {
  it('should show each role with its identity, its setup and an agent that is not installed', async () => {
    const app = openConversation();
    emit(app, {
      type: 'profiles',
      conversationId: 'c1',
      configured: true,
      profiles: [
        { ...roleProfiles[0], agent: { id: 'codex', name: 'Codex', available: false }, model: { id: 'm', name: 'GPT' }, effort: { id: 'e', name: 'High' } },
        roleProfiles[1],
      ],
      customized: false,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Agent settings' }));

    const roles = within(dialog()).getByRole('list', { name: 'Roles' });
    expect(within(roles).getByText('CEO')).toBeInTheDocument();
    expect(within(roles).getByText('Codex · GPT · High')).toBeInTheDocument();
    expect(within(roles).getByText('not installed')).toBeInTheDocument();
    expect(within(roles).getByText('Not configured')).toBeInTheDocument();
    expect(within(dialog()).getByText('One agent, model and effort for all 2 roles.')).toBeInTheDocument();
  });

  it('should change one role through agent, model and effort, loading each list', async () => {
    const app = await openSettings();
    const { user, connection } = app;

    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    const developer = editor('Developer');
    expect(within(developer).getByRole('combobox', { name: 'Model' })).toBeDisabled();
    expect(within(developer).getByRole('button', { name: 'Save' })).toBeDisabled();

    await pick(user, developer, 'Agent', 'Codex');
    expect(connection.sent).toContainEqual({ type: 'models.list', agentId: 'codex' });
    expect(within(developer).getByRole('combobox', { name: 'Model' })).toHaveAttribute('aria-busy', 'true');
    expect(within(developer).getByRole('status')).toHaveTextContent('Loading…');

    emit(app, { type: 'models.list', agentId: 'other', models: [] });
    expect(within(developer).getByRole('status')).toBeInTheDocument();
    emit(app, { type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT' }] });
    await pick(user, developer, 'Model', 'GPT');
    expect(connection.sent).toContainEqual({ type: 'efforts.list', agentId: 'codex', modelId: 'gpt' });
    expect(within(developer).getByRole('button', { name: 'Save' })).toBeDisabled();

    emit(app, { type: 'efforts.list', agentId: 'codex', modelId: 'other', efforts: [] });
    emit(app, { type: 'efforts.list', agentId: 'codex', modelId: 'gpt', efforts: [{ id: 'high', name: 'High' }] });
    await pick(user, developer, 'Effort', 'High');
    await user.click(within(developer).getByRole('button', { name: 'Save' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'profiles.set', conversationId: 'c1', roles: ['DEVELOPER'], agentId: 'codex', modelId: 'gpt', effortId: 'high',
    });
    expect(within(developer).getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');

    emit(app, { type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles, customized: false });
    expect(within(dialog()).queryByRole('group', { name: 'Developer' })).not.toBeInTheDocument();
    expect(await screen.findByText('Developer saved')).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
  });

  it('should apply to every role only through its own action, with agents that offer no model or effort', async () => {
    const app = await openSettings();
    const { user, connection } = app;

    await user.click(within(dialog()).getByRole('button', { name: 'Set for every role' }));
    const team = editor('Every role');
    expect(within(team).getByRole('combobox', { name: 'Effort' })).toBeDisabled();
    await pick(user, team, 'Agent', 'Claude Code');
    emit(app, { type: 'models.list', agentId: 'claude', models: [] });

    expect(within(team).getByText('Claude Code runs on its default model.')).toBeInTheDocument();
    expect(within(team).getByText('No effort to choose.')).toBeInTheDocument();
    await user.click(within(team).getByRole('button', { name: 'Apply to all 2 roles' }));

    expect(connection.sent.at(-1)).toEqual({ type: 'profiles.set', conversationId: 'c1', agentId: 'claude' });
  });

  it('should save a model that offers no effort', async () => {
    const app = await openSettings();
    const { user, connection } = app;
    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    const developer = editor('Developer');

    await pick(user, developer, 'Agent', 'Claude Code');
    emit(app, { type: 'models.list', agentId: 'claude', models: [{ id: 'opus', name: 'Opus' }] });
    await pick(user, developer, 'Model', 'Opus');
    emit(app, { type: 'efforts.list', agentId: 'claude', modelId: 'opus', efforts: [] });
    await user.click(within(developer).getByRole('button', { name: 'Save' }));

    expect(connection.sent.at(-1)).toEqual({
      type: 'profiles.set', conversationId: 'c1', roles: ['DEVELOPER'], agentId: 'claude', modelId: 'opus',
    });
  });

  it('should start from the current setup and keep the lists it already loaded', async () => {
    const app = await openSettings();
    const { user } = app;

    await user.click(within(dialog()).getByRole('button', { name: 'Change CEO' }));
    expect(within(editor('CEO')).getByRole('combobox', { name: 'Agent' })).toHaveTextContent('Codex');
    expect(sentOf(app, 'models.list')).toEqual([{ type: 'models.list', agentId: 'codex' }]);
    emit(app, { type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT' }] });
    await user.click(within(editor('CEO')).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog()).queryByRole('group', { name: 'CEO' })).not.toBeInTheDocument();

    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    await pick(user, editor('Developer'), 'Agent', 'Codex');

    expect(sentOf(app, 'models.list')).toHaveLength(1);
    expect(within(editor('Developer')).getByRole('combobox', { name: 'Model' })).toBeEnabled();
  });

  it('should ask for the efforts of a model once', async () => {
    const app = await openSettings();
    const { user } = app;
    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    const developer = editor('Developer');
    await pick(user, developer, 'Agent', 'Codex');
    emit(app, { type: 'models.list', agentId: 'codex', models: [{ id: 'gpt', name: 'GPT' }, { id: 'mini', name: 'Mini' }] });

    await pick(user, developer, 'Model', 'GPT');
    await pick(user, developer, 'Model', 'Mini');
    await pick(user, developer, 'Model', 'GPT');

    expect(sentOf(app, 'efforts.list')).toEqual([
      { type: 'efforts.list', agentId: 'codex', modelId: 'gpt' },
      { type: 'efforts.list', agentId: 'codex', modelId: 'mini' },
    ]);
  });

  it('should show errors in the open editor and ask again for the lists left loading', async () => {
    const app = await openSettings();
    const { user, connection } = app;
    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    await pick(user, editor('Developer'), 'Agent', 'Codex');

    emit(app, { type: 'error', message: 'Other conversation', conversationId: 'zzz' });
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    emit(app, { type: 'error', message: 'Agent unavailable' });
    expect(within(editor('Developer')).getByRole('alert')).toHaveTextContent('Agent unavailable');

    await user.click(within(editor('Developer')).getByRole('button', { name: 'Cancel' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
    expect(within(editor('Developer')).queryByRole('alert')).not.toBeInTheDocument();
    await pick(user, editor('Developer'), 'Agent', 'Codex');
    expect(sentOf(app, 'models.list')).toHaveLength(2);

    emit(app, { type: 'models.list', agentId: 'codex', models: [] });
    await user.click(within(editor('Developer')).getByRole('button', { name: 'Save' }));
    emit(app, { type: 'error', message: 'Unknown agent', conversationId: 'c1' });
    expect(within(editor('Developer')).getByRole('alert')).toHaveTextContent('Unknown agent');
    expect(within(editor('Developer')).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(connection.sent.at(-1)).toMatchObject({ type: 'profiles.set', roles: ['DEVELOPER'] });
  });

  it('should keep the editor open for profiles it did not save', async () => {
    const app = await openSettings();
    await app.user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));

    emit(app, { type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles, customized: false });

    expect(editor('Developer')).toBeInTheDocument();
  });

  it('should open on the team setup when the conversation has none, and Cancel dismisses it', async () => {
    const { user } = await openSettings({ configured: false });

    expect(within(dialog()).getByText('Choose what the team runs on to start this conversation.')).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Set for every role' })).not.toBeInTheDocument();
    await user.click(within(editor('Every role')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should close', async () => {
    const { user } = await openSettings();
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  describe('squads', () => {
    const squadSection = () => within(dialog()).getByRole('region', { name: 'Squad' });

    it.each([
      [undefined, false, 'Custom'],
      [{ id: 's1', name: 'Backend team' }, false, 'Squad Backend team'],
      [{ id: 's1', name: 'Backend team' }, true, 'Squad Backend team · customized'],
    ])('should tell which squad the roles come from (%j, customized %s)', async (appliedSquad, customized, text) => {
      const app = await openSettings();
      emit(app, { type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles, appliedSquad, customized });

      expect(squadSection()).toHaveTextContent(`Now: ${text}`);
    });

    it('should ask for the squads when it opens and apply the one picked', async () => {
      const app = await openSettings();
      const { user, connection } = app;
      expect(connection.sent).toContainEqual({ type: 'squads.list' });
      expect(within(squadSection()).getByRole('combobox', { name: 'Apply squad' })).toBeDisabled();
      expect(within(squadSection()).getByRole('combobox', { name: 'Apply squad' })).toHaveTextContent('No squad yet');

      emit(app, { type: 'squads', squads: [squad(), squad({ id: 's2', name: 'Frontend team' })] });
      await pick(user, squadSection(), 'Apply squad', 'Frontend team');

      expect(connection.sent).toContainEqual({ type: 'squads.apply', conversationId: 'c1', squadId: 's2' });
      expect(within(squadSection()).getByRole('combobox', { name: 'Apply squad' })).toBeDisabled();
      emit(app, { type: 'profiles', conversationId: 'c1', configured: true, profiles: roleProfiles, appliedSquad: { id: 's2', name: 'Frontend team' }, customized: false });

      expect(await screen.findByText('Squad Frontend team applied')).toBeInTheDocument();
      expect(squadSection()).toHaveTextContent('Now: Squad Frontend team');
      expect(within(squadSection()).getByRole('combobox', { name: 'Apply squad' })).toBeEnabled();
    });

    it('should show why a squad was not applied', async () => {
      const app = await openSettings();
      emit(app, { type: 'squads', squads: [squad()] });
      await pick(app.user, squadSection(), 'Apply squad', 'Backend team');

      emit(app, { type: 'error', message: 'Unknown squad', conversationId: 'c1' });

      expect(within(squadSection()).getByRole('combobox', { name: 'Apply squad' })).toBeEnabled();
      expect(within(squadSection()).getByRole('alert')).toHaveTextContent('Unknown squad');
      await app.user.click(within(dialog()).getByRole('button', { name: 'Change Developer' }));
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('should save the roles that have a setup as a new squad', async () => {
      const { user, router } = await openSettings();

      await user.click(within(squadSection()).getByRole('button', { name: 'Save as squad' }));

      expect(router.state.location.pathname).toBe('/settings/squads/new');
      expect(router.state.location.state).toEqual({ returnTo: '/c/c1', draft: { profiles: { CEO: { agentId: 'codex', modelId: undefined, effortId: undefined } } } });
    });

    it('should ask for the profiles again when the squads change, since the conversation may not match its squad', () => {
      const app = openConversation();
      const before = sentOf(app, 'profiles.get').length;

      emit(app, { type: 'squads', squads: [] });

      expect(sentOf(app, 'profiles.get')).toHaveLength(before + 1);
    });

    it('should open the squads, coming back to the conversation', async () => {
      const { user, router } = await openSettings();

      await user.click(within(squadSection()).getByRole('link', { name: 'Manage squads' }));

      expect(router.state.location.pathname).toBe('/settings/squads');
      expect(router.state.location.state).toEqual({ returnTo: '/c/c1' });
    });
  });
});
