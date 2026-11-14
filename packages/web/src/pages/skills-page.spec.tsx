import type { SkillDetail, SkillSummary } from '@agent-remote-control/protocol/skill';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AT, renderApp } from '../test/render-app.js';


const SKILLS: SkillSummary[] = [
  { name: 'api-testing', description: 'Testing an HTTP API.', roles: ['QA'], builtIn: true },
  { name: 'artifact-board', description: 'Running the board.', roles: ['CEO'], builtIn: true },
  { name: 'electron-testing', description: 'Testing Electron apps.', roles: ['QA', 'DEVELOPER'], builtIn: false },
];

const detail = (name: string): SkillDetail => ({ ...SKILLS.find(skill => skill.name === name)!, content: `# ${name}\n\nDo it well.` });

describe('SkillsPage', () => {
  it('asks for the skills once connected and lists the custom ones before the built-in ones', () => {
    const { connection } = renderApp('/skills');

    expect(connection.sent).toContainEqual({ type: 'skills.list' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading skills…');
    act(() => connection.emitEvent({ type: 'skills.list', skills: SKILLS }));

    const custom = screen.getByRole('region', { name: 'Custom' });
    const builtIn = screen.getByRole('region', { name: 'Built-in' });
    expect(within(custom).getByRole('link', { name: /electron-testing/ })).toHaveAttribute('href', '/skills/electron-testing');
    expect(within(custom).getByRole('list', { name: 'Read by' })).toHaveTextContent('QADeveloper');
    expect(within(builtIn).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/skills/api-testing', '/skills/artifact-board']);
    expect(screen.getByText('Pick a skill')).toBeInTheDocument();
  });

  it('filters the skills by text and by the role that reads them', async () => {
    const user = userEvent.setup();
    const { connection } = renderApp('/skills');
    act(() => connection.emitEvent({ type: 'skills.list', skills: SKILLS }));

    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'BOARD');
    expect(screen.getAllByRole('link', { name: /testing|board/ }).map(link => link.getAttribute('href'))).toEqual(['/skills/artifact-board']);
    expect(screen.queryByRole('region', { name: 'Custom' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Search skills' }));
    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await user.click(await screen.findByRole('option', { name: 'QA' }));
    expect(screen.getAllByRole('link', { name: /testing|board/ }).map(link => link.getAttribute('href'))).toEqual(['/skills/electron-testing', '/skills/api-testing']);

    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'nothing');
    expect(screen.getByText('No skill matches.')).toBeInTheDocument();
  });

  it('reads a built-in skill, which is read-only', () => {
    const { connection } = renderApp('/skills/api-testing');
    act(() => connection.emitEvent({ type: 'skills.list', skills: SKILLS }));

    expect(connection.sent).toContainEqual({ type: 'skill.get', name: 'api-testing' });
    expect(within(screen.getByRole('region', { name: 'Skill' })).getByRole('status')).toHaveTextContent('Loading…');
    act(() => connection.emitEvent({ type: 'skill.detail', name: 'api-testing', skill: detail('api-testing') }));

    const pane = screen.getByRole('region', { name: 'Skill' });
    expect(within(pane).getByRole('heading', { name: 'api-testing', level: 2 })).toBeInTheDocument();
    expect(within(pane).getByText('Built-in')).toBeInTheDocument();
    expect(within(pane).getByText(/Built-in skills ship with the server and are read-only/)).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Ask the Coordinator' })).not.toBeInTheDocument();
    expect(within(pane).getByText('Do it well.')).toBeInTheDocument();
  });

  it('tells when no skill has the name', () => {
    const { connection } = renderApp('/skills/missing');
    act(() => connection.emitEvent({ type: 'skill.detail', name: 'missing', skill: null }));

    expect(screen.getByText('No skill is named "missing".')).toBeInTheDocument();
  });

  it('opens a new conversation with a request to the Coordinator to change a custom skill', async () => {
    const user = userEvent.setup();
    const { connection, router } = renderApp('/skills/electron-testing');
    act(() => connection.emitEvent({ type: 'skill.detail', name: 'electron-testing', skill: detail('electron-testing') }));

    expect(screen.getByText('Custom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask the Coordinator' }));
    const create = connection.sent.find(command => command.type === 'conversation.create') as { requestId: string };
    act(() => connection.emitEvent({
      type: 'conversation.created',
      requestId: create.requestId,
      conversation: { id: 'new', title: 'New', createdAt: AT, updatedAt: AT },
    }));

    expect(router.state.location.pathname).toBe('/c/new');
    expect(router.state.location.state).toBeNull();
    expect(screen.getByRole('textbox', { name: /message/i })).toHaveValue('Change the skill "electron-testing": ');
  });

  it('is reached from the header', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/');

    await user.click(screen.getByRole('link', { name: 'Skills' }));

    expect(router.state.location.pathname).toBe('/skills');
  });
});
