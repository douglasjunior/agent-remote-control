import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { type AppHarness, AT, renderApp, roleProfiles } from '../test/render-app.js';
import { squad } from '../test/squad-fixtures.js';


const backend = squad({ id: 's1', name: 'Backend team', isDefault: true });
const frontend = squad({ id: 's2', name: 'Frontend team' });

const emit = (app: AppHarness, event: ServerEvent) => act(() => app.connection.emitEvent(event));
const sentOf = (app: AppHarness, type: string) => app.connection.sent.filter(command => command.type === type);
const field = () => screen.getByLabelText('Message');
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function openHome(squads: readonly ReturnType<typeof squad>[] = [backend, frontend]) {
  const app = renderApp();
  emit(app, { type: 'squads', squads: [...squads] });
  return { user: userEvent.setup(), ...app };
}

function created(app: AppHarness, id = 'new') {
  const request = sentOf(app, 'conversation.create').at(-1) as { requestId: string };
  emit(app, { type: 'conversation.created', requestId: request.requestId, conversation: { id, title: 'New', createdAt: AT, updatedAt: AT } });
}

const applied = (app: AppHarness, squadId: string, conversationId = 'new') => emit(app, {
  type: 'profiles',
  conversationId,
  configured: true,
  profiles: roleProfiles,
  appliedSquad: { id: squadId, name: 'Applied' },
  customized: false,
});

afterEach(() => {
  act(() => toast.dismiss());
});

describe('HomePage', () => {
  it('should greet the user and offer a composer without attachments or audio', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: 'What should your squad build today?' })).toBeInTheDocument();
    expect(field()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Attach' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record audio' })).not.toBeInTheDocument();
    expect(screen.getByText('Attachments and audio are available once the conversation starts.')).toBeInTheDocument();
  });

  it('should ask for the squads once connected', () => {
    const app = renderApp();
    expect(app.connection.sent).toContainEqual({ type: 'squads.list' });
  });

  it('should disable the composer while the connection is not open', () => {
    const app = renderApp();
    act(() => app.connection.emitStatus('closed'));
    expect(field()).toBeDisabled();
  });

  it('should keep Send disabled until something is written', async () => {
    const { user } = openHome();
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();

    await user.type(field(), 'hi');
    expect(screen.getByRole('button', { name: 'Start conversation' })).toBeEnabled();
  });

  it('should walk the prompt history with ArrowUp', async () => {
    const app = openHome();
    await app.user.click(field());
    await app.user.keyboard('{ArrowUp}');

    const request = sentOf(app, 'prompts.history')[0] as { requestId: string };
    expect(request).toBeDefined();
    emit(app, { type: 'prompts.list', requestId: request.requestId, prompts: ['earlier prompt'] });

    expect(await screen.findByDisplayValue('earlier prompt')).toBeInTheDocument();
  });

  describe('squad picker', () => {
    it('should preselect the default squad and list the others with Custom', async () => {
      const { user } = openHome();
      const picker = screen.getByRole('combobox', { name: 'Squad' });
      expect(picker).toHaveTextContent('Backend team (default)');

      await user.click(picker);
      expect(await screen.findAllByRole('option')).toHaveLength(3);
      expect(screen.getByRole('option', { name: 'Frontend team' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Custom (inherit)' })).toBeInTheDocument();
    });

    it('should preselect Custom when no squad is the default', () => {
      openHome([frontend]);
      expect(screen.getByRole('combobox', { name: 'Squad' })).toHaveTextContent('Custom (inherit)');
    });

    it('should be hidden without squads and before the list arrives', () => {
      const app = renderApp();
      expect(screen.queryByRole('combobox', { name: 'Squad' })).not.toBeInTheDocument();

      emit(app, { type: 'squads', squads: [] });
      expect(screen.queryByRole('combobox', { name: 'Squad' })).not.toBeInTheDocument();
    });

    it('should fall back to the default squad when the chosen one is deleted', async () => {
      const app = openHome();
      await app.user.click(screen.getByRole('combobox', { name: 'Squad' }));
      await app.user.click(await screen.findByRole('option', { name: 'Frontend team' }));
      expect(screen.getByRole('combobox', { name: 'Squad' })).toHaveTextContent('Frontend team');

      emit(app, { type: 'squads', squads: [backend] });
      expect(screen.getByRole('combobox', { name: 'Squad' })).toHaveTextContent('Backend team (default)');
    });
  });

  describe('sending', () => {
    it('should create the conversation, apply the squad, send the first message once applied and open it', async () => {
      const app = openHome();
      await app.user.type(field(), 'Build a login page{Enter}');

      expect(sentOf(app, 'conversation.create')).toHaveLength(1);
      expect(sentOf(app, 'message.send')).toEqual([]);

      created(app);
      expect(sentOf(app, 'squads.apply')).toEqual([{ type: 'squads.apply', conversationId: 'new', squadId: 's1' }]);
      expect(sentOf(app, 'message.send')).toEqual([]);
      expect(app.router.state.location.pathname).toBe('/c/new');

      applied(app, 's1');
      expect(sentOf(app, 'message.send')).toEqual([{ type: 'message.send', conversationId: 'new', text: 'Build a login page' }]);
    });

    it('should apply the squad picked instead of the default', async () => {
      const app = openHome();
      await app.user.click(screen.getByRole('combobox', { name: 'Squad' }));
      await app.user.click(await screen.findByRole('option', { name: 'Frontend team' }));
      await app.user.type(field(), 'Polish the UI');
      await app.user.click(screen.getByRole('button', { name: 'Start conversation' }));

      created(app);
      expect(sentOf(app, 'squads.apply')).toEqual([{ type: 'squads.apply', conversationId: 'new', squadId: 's2' }]);
    });

    it('should wait for the squad that was asked for, and for the conversation that asked', async () => {
      const app = openHome();
      await app.user.type(field(), 'Go{Enter}');
      created(app);

      applied(app, 's2');
      applied(app, 's1', 'other');
      expect(sentOf(app, 'message.send')).toEqual([]);

      emit(app, { type: 'profiles', conversationId: 'new', configured: false, profiles: roleProfiles, customized: false });
      expect(sentOf(app, 'message.send')).toEqual([]);

      applied(app, 's1');
      expect(sentOf(app, 'message.send')).toHaveLength(1);
    });

    it('should send at once and apply nothing for Custom', async () => {
      const app = openHome();
      await app.user.click(screen.getByRole('combobox', { name: 'Squad' }));
      await app.user.click(await screen.findByRole('option', { name: 'Custom (inherit)' }));
      await app.user.type(field(), 'Just do it{Enter}');

      created(app);
      expect(sentOf(app, 'squads.apply')).toEqual([]);
      expect(sentOf(app, 'message.send')).toEqual([{ type: 'message.send', conversationId: 'new', text: 'Just do it' }]);
      expect(app.router.state.location.pathname).toBe('/c/new');
    });

    it('should send at once without squads', async () => {
      const app = openHome([]);
      await app.user.type(field(), 'Hello{Enter}');

      created(app);
      expect(sentOf(app, 'squads.apply')).toEqual([]);
      expect(sentOf(app, 'message.send')).toHaveLength(1);
    });

    it('should report a squad that could not be applied and send the message anyway', async () => {
      const app = openHome();
      await app.user.type(field(), 'Go{Enter}');
      created(app);

      emit(app, { type: 'error', message: 'Unknown squad', conversationId: 'new' });
      expect(await screen.findByText('Unknown squad')).toBeInTheDocument();
      expect(sentOf(app, 'message.send')).toHaveLength(1);

      emit(app, { type: 'error', message: 'Again', conversationId: 'new' });
      expect(sentOf(app, 'message.send')).toHaveLength(1);
      expect(screen.queryByText('Again')).not.toBeInTheDocument();
    });

    it('should lock the composer until the conversation exists, and unlock it after a lost connection', async () => {
      const app = openHome();
      await app.user.type(field(), 'Go{Enter}');
      expect(field()).toBeDisabled();

      act(() => app.connection.emitStatus('closed'));
      act(() => app.connection.emitStatus('open'));
      expect(field()).toBeEnabled();
    });
  });

  describe('recent conversations', () => {
    const conversation = (id: string, title: string, updatedAt = AT, archivedAt?: string) => ({
      id, title, createdAt: AT, updatedAt, ...(archivedAt && { archivedAt }),
    });

    it('should link the six most recent active conversations with their relative time', () => {
      const app = renderApp();
      emit(app, {
        type: 'conversation.list',
        conversations: [
          conversation('c1', 'First', hoursAgo(3)),
          conversation('arch', 'Archived one', hoursAgo(4), AT),
          ...['c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map(id => conversation(id, `Title ${id}`, hoursAgo(5))),
        ],
      });

      const section = screen.getByRole('region', { name: 'Recent conversations' });
      const links = within(section).getAllByRole('link');
      expect(links).toHaveLength(6);
      expect(links[0]).toHaveAttribute('href', '/c/c1');
      expect(links[0]).toHaveTextContent('First');
      expect(links[0]).toHaveTextContent('3 hours ago');
      expect(within(section).queryByText('Archived one')).not.toBeInTheDocument();
      expect(within(section).queryByText('Title c7')).not.toBeInTheDocument();
    });

    it('should open a conversation from its card', async () => {
      const app = renderApp();
      emit(app, { type: 'conversation.list', conversations: [conversation('c1', 'First', hoursAgo(1))] });

      await userEvent.setup().click(screen.getByRole('link', { name: /First/ }));

      expect(app.router.state.location.pathname).toBe('/c/c1');
    });

    it('should show no recent section without conversations or with only archived ones', () => {
      const app = renderApp();
      expect(screen.queryByRole('region', { name: 'Recent conversations' })).not.toBeInTheDocument();

      emit(app, { type: 'conversation.list', conversations: [conversation('a', 'Old', AT, AT)] });
      expect(screen.queryByRole('region', { name: 'Recent conversations' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'See all' })).not.toBeInTheDocument();
    });
  });
});
