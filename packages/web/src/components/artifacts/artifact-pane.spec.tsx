import type { ArtifactDetail } from '@agent-remote-control/protocol/artifact';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { answer, CONVERSATION_ID, detail, lastSent, openBoard, showDetail, summary } from '../../test/artifact-fixtures.js';
import { AT } from '../../test/render-app.js';


const feature = summary({ id: 'F-1', type: 'feature', title: 'Login', status: 'in_progress' });
const form = summary({ id: 'T-1', title: 'Login form', parentId: 'F-1', status: 'done' });
const blocked = summary({ id: 'T-5', title: 'Login e2e', parentId: 'F-1', dependsOn: ['T-2'] });
const typo = summary({ id: 'T-3', title: 'Fix typo', projectName: 'site' });
const api = detail({
  id: 'T-2',
  title: 'Login API',
  parentId: 'F-1',
  status: 'in_progress',
  dependsOn: ['T-1', 'T-9'],
  refinement: { business: 'done', design: 'skipped', technical: 'pending' },
  assignee: { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd1', since: AT },
  branch: 'feat/login-api',
  pullRequests: [
    { url: 'https://example.com/pr/1', title: 'Add login API', repository: '.', state: 'merged', addedAt: AT },
    { url: 'https://example.com/pr/2', repository: 'repositories/api', state: 'open', addedAt: AT },
  ],
  sections: { overview: 'Users sign in.', technical_solution: '' },
  history: [
    { id: 'h1', at: AT, actor: { kind: 'user', channel: 'web' }, kind: 'created', summary: 'created the task' },
    {
      id: 'h2',
      at: AT,
      actor: { kind: 'agent', role: 'CEO', roleName: 'CEO' },
      kind: 'updated',
      summary: 'moved it forward',
      changes: [
        { field: 'status', from: 'ready', to: 'in_progress' },
        { field: 'section:overview', to: 'replaced' },
        { field: 'section:unknown_part', to: 'appended' },
        { field: 'dependsOn', from: '', to: 'T-1' },
        { field: 'branch' },
      ],
    },
    { id: 'h3', at: AT, actor: { kind: 'system' }, kind: 'commented', summary: 'commented', text: 'Restarted' },
  ],
});
const board = [feature, form, blocked, typo, summary(api)];

function openArtifact(artifact: ArtifactDetail = api, artifacts = board) {
  const user = userEvent.setup();
  const app = openBoard(artifacts, { path: `/c/${CONVERSATION_ID}/tasks/${artifact.id}` });
  showDetail(app, artifact);
  return { user, app };
}


afterEach(() => {
  act(() => toast.dismiss());
});

describe('ArtifactPane', () => {
  it('should ask for the artifact and again whenever it changes', () => {
    const { app } = openArtifact();
    expect(app.connection.sent).toContainEqual({ type: 'artifact.get', conversationId: CONVERSATION_ID, id: 'T-2' });
    const asked = () => app.connection.sent.filter(command => command.type === 'artifact.get').length;
    const before = asked();
    act(() => app.connection.emitEvent({ type: 'artifact.updated', conversationId: CONVERSATION_ID, artifact: form }));
    act(() => app.connection.emitEvent({ type: 'artifact.updated', conversationId: 'c2', artifact: summary(api) }));
    expect(asked()).toBe(before);
    act(() => app.connection.emitEvent({ type: 'artifact.updated', conversationId: CONVERSATION_ID, artifact: summary({ ...summary(api), status: 'in_review' }) }));
    expect(asked()).toBe(before + 1);
    expect(screen.getAllByText('In review').length).toBeGreaterThan(0);
  });

  it('should show the artifact with its feature, its holder and its properties', () => {
    openArtifact();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/c/c1/tasks');
    expect(within(crumbs).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/c/c1/tasks/F-1');
    expect(screen.getByRole('heading', { name: 'Login API', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Task T-2')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Developer is working on it')).toBeInTheDocument();
    expect(screen.getByText('Users sign in.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Technical solution' })).not.toBeInTheDocument();

    const properties = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(properties).getByText('app')).toBeInTheDocument();
    expect(within(properties).getByRole('link', { name: /Login form/ })).toHaveAttribute('href', '/c/c1/tasks/T-1');
    expect(within(properties).getByText('T-9')).toBeInTheDocument();
    expect(within(properties).getByRole('link', { name: /Login e2e/ })).toBeInTheDocument();
    expect(within(properties).getByText('feat/login-api')).toBeInTheDocument();
    expect(within(properties).getByRole('link', { name: 'Add login API, merged' })).toHaveAttribute('href', 'https://example.com/pr/1');
    expect(within(properties).getByRole('link', { name: 'https://example.com/pr/2, open, repositories/api' })).toHaveAttribute('target', '_blank');
    expect(within(properties).getByText('repositories/api')).toBeInTheDocument();
    expect(within(properties).queryByText('.')).not.toBeInTheDocument();
  });

  it('should wait for the artifact, and say when it does not exist', () => {
    openBoard(board, { path: `/c/${CONVERSATION_ID}/tasks/T-2` });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    openBoard(board, { path: `/c/${CONVERSATION_ID}/tasks/T-404` });
    expect(screen.getByText('T-404 does not exist, or it was deleted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/c/c1/tasks');
  });

  it('should rename the artifact', async () => {
    const { user, app } = openArtifact();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(input, 'Sign-in API');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-2', changes: { title: 'Sign-in API' } });
    await answer(app, 'artifact.update', { ok: false, error: 'Too long' });
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await answer(app, 'artifact.update', { ok: true, id: 'T-2' });
    expect(await screen.findByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it.each([
    ['Status', 'Approved', { status: 'approved' }],
    ['Business refinement', 'Not needed', { refinement: { business: 'skipped' } }],
    ['Design refinement', 'Pending', { refinement: { design: 'pending' } }],
    ['Technical refinement', 'Done', { refinement: { technical: 'done' } }],
    ['Feature', 'Standalone task', { parentId: null }],
  ])('should change the %s', async (combobox, option, changes) => {
    const { user, app } = openArtifact();
    await user.click(screen.getByRole('combobox', { name: combobox }));
    await user.click(await screen.findByRole('option', { name: option }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-2', changes });
  });

  it('should move a standalone task to another project or into a feature of its project', async () => {
    const standalone = detail({ id: 'T-3', title: 'Fix typo', projectName: 'site' });
    const other = summary({ id: 'F-2', type: 'feature', title: 'Landing', projectName: 'site' });
    const { user, app } = openArtifact(standalone, [...board, other]);
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'app' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-3', changes: { projectName: 'app' } });
    await user.click(screen.getByRole('combobox', { name: 'Feature' }));
    expect(screen.queryByRole('option', { name: 'F-1 · Login' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'F-2 · Landing' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-3', changes: { parentId: 'F-2' } });
  });

  it('should only read the project of a task whose feature links a single one', () => {
    openArtifact();
    expect(screen.queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Properties' })).getByTitle('The project of its feature')).toHaveTextContent('app');
  });

  describe('a feature linking several projects', () => {
    const shared = summary({ id: 'F-3', type: 'feature', title: 'Shared', projectNames: ['site', 'app'] });
    const siteTask = summary({ id: 'T-7', title: 'Site part', parentId: 'F-3', projectName: 'site' });
    const sharedBoard = [...board, shared, siteTask];

    it('should edit the list of its projects', async () => {
      const { user, app } = openArtifact(detail({ ...shared, sections: {} }), sharedBoard);
      const properties = screen.getByRole('complementary', { name: 'Properties' });
      expect(within(properties).getByText('Projects')).toBeInTheDocument();
      expect(within(properties).queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();

      await user.click(within(properties).getByRole('button', { name: 'Remove app' }));
      expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'F-3', changes: { projectNames: ['site'] } });

      await user.click(within(properties).getByRole('combobox', { name: 'Projects' }));
      expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['app', 'site']);
    });

    it('should offer the workspace projects and add one to the list', async () => {
      const { user, app } = openArtifact(detail({ ...shared, projectNames: ['site'], sections: {} }), sharedBoard);
      const properties = screen.getByRole('complementary', { name: 'Properties' });
      expect(within(properties).queryByRole('button', { name: 'Remove site' })).not.toBeInTheDocument();

      await user.click(within(properties).getByRole('combobox', { name: 'Projects' }));
      await user.click(await screen.findByRole('option', { name: 'app' }));
      expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'F-3', changes: { projectNames: ['site', 'app'] } });
    });

    it('should keep the list and show the error when the server refuses to drop a project its tasks use', async () => {
      const { user, app } = openArtifact(detail({ ...shared, sections: {} }), sharedBoard);
      await user.click(within(screen.getByRole('complementary', { name: 'Properties' })).getByRole('button', { name: 'Remove site' }));
      expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'F-3', changes: { projectNames: ['app'] } });

      await answer(app, 'artifact.update', { ok: false, error: 'Tasks of F-3 still work in site: T-7' });

      expect(await screen.findByText('Tasks of F-3 still work in site: T-7')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove site' })).toBeInTheDocument();
    });

    it('should limit a task of the feature to its projects', async () => {
      const { user, app } = openArtifact(detail({ ...siteTask, sections: {} }), sharedBoard);
      await user.click(screen.getByRole('combobox', { name: 'Project' }));
      expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['site', 'app']);
      await user.click(screen.getByRole('option', { name: 'app' }));
      expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-7', changes: { projectName: 'app' } });
    });
  });

  it('should add and remove dependencies', async () => {
    const { user, app } = openArtifact();
    await user.click(screen.getByRole('button', { name: 'Remove dependency T-1' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ changes: { dependsOn: ['T-9'] } });
    await user.click(screen.getByRole('combobox', { name: 'Add a dependency' }));
    expect(screen.queryByRole('option', { name: 'T-3 · Fix typo' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'T-5 · Login e2e' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ changes: { dependsOn: ['T-1', 'T-9', 'T-5'] } });
  });

  it('should let a feature depend on other features and show the ones it blocks', async () => {
    const later = summary({ id: 'F-9', type: 'feature', title: 'Reports', dependsOn: ['F-1'] });
    const { user, app } = openArtifact(detail({ ...feature, sections: {} }), [...board, later, summary({ id: 'F-8', type: 'feature', title: 'Search' })]);
    const properties = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(properties).getByRole('link', { name: /Reports/ })).toHaveAttribute('href', '/c/c1/tasks/F-9');
    await user.click(within(properties).getByRole('combobox', { name: 'Add a dependency' }));
    expect(screen.queryByRole('option', { name: 'T-3 · Fix typo' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'F-8 · Search' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'F-1', changes: { dependsOn: ['F-8'] } });
  });

  it('should edit a section and add one', async () => {
    const { user, app } = openArtifact();
    await user.click(screen.getByRole('button', { name: 'Edit Overview' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Overview' }));
    const editor = screen.getByRole('textbox', { name: 'Overview' });
    await user.clear(editor);
    await user.type(editor, '  People sign in with email.  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ changes: { sections: { overview: 'People sign in with email.' } } });
    await answer(app, 'artifact.update', { ok: false, error: 'Busy' });
    expect(screen.getByRole('textbox', { name: 'Overview' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await answer(app, 'artifact.update', { ok: true, id: 'T-2' });
    expect(await screen.findByRole('button', { name: 'Edit Overview' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Test cases' }));
    expect(screen.getByRole('textbox', { name: 'Test cases' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Test cases' })).not.toBeInTheDocument();
  });

  it('should render the review findings like any other section, after the implementation notes', () => {
    openArtifact(detail({
      ...api,
      sections: {
        implementation_notes: 'Done with a shared client.',
        review_findings: '1. **Major**: the token is logged.\n2. **Minor**: rename the helper.',
        test_report: 'PASSED: sign-in works in Chromium.',
      },
    }));
    const headings = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(headings.indexOf('Review findings')).toBe(headings.indexOf('Implementation notes') + 1);
    expect(headings.indexOf('Test report')).toBe(headings.indexOf('Review findings') + 1);
    expect(screen.getByText('the token is logged.', { exact: false })).toBeInTheDocument();
  });

  it('should invite to describe an artifact without sections', () => {
    openArtifact(detail({ id: 'T-3', title: 'Fix typo', projectName: 'site' }));
    expect(screen.getByText(/No description yet/)).toBeInTheDocument();
  });

  it('should comment and show the activity, newest first', async () => {
    const { user, app } = openArtifact();
    const activity = screen.getByRole('region', { name: 'Activity' });
    const items = within(activity).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('System');
    expect(items[0]).toHaveTextContent('Restarted');
    expect(within(activity).getByRole('img', { name: 'CEO, idle' })).toBeInTheDocument();
    expect(within(activity).getByText('You')).toBeInTheDocument();
    expect(within(activity).getByText('In progress', { selector: 'span' })).toBeInTheDocument();
    expect(within(activity).getByText('Ready')).toBeInTheDocument();
    expect(within(activity).getByText('unknown_part')).toBeInTheDocument();
    expect(within(activity).getByText('Depends on')).toBeInTheDocument();
    expect(within(activity).getByText('Branch')).toBeInTheDocument();

    const box = within(activity).getByRole('textbox', { name: 'Comment' });
    await user.type(box, 'Use the shared client');
    await user.click(within(activity).getByRole('button', { name: 'Comment' }));
    expect(lastSent(app, 'artifact.comment')).toMatchObject({ id: 'T-2', text: 'Use the shared client' });
    await answer(app, 'artifact.comment', { ok: false, error: 'Busy' });
    expect(await screen.findByText('Busy')).toBeInTheDocument();
    expect(box).toHaveValue('Use the shared client');
    await user.click(within(activity).getByRole('button', { name: 'Comment' }));
    await answer(app, 'artifact.comment', { ok: true, id: 'T-2' });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('should delete the artifact after a confirmation and return to the board', async () => {
    const { user, app } = openArtifact();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(app.connection.sent.some(command => command.type === 'artifact.delete')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(lastSent(app, 'artifact.delete')).toMatchObject({ id: 'T-2' });
    await answer(app, 'artifact.delete', { ok: false, error: 'Held by the Developer' });
    expect(app.router.state.location.pathname).toBe('/c/c1/tasks/T-2');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await answer(app, 'artifact.delete', { ok: true, id: 'T-2' });
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/c/c1/tasks'));
  });

  it('should list the tasks of a feature and add one to it', async () => {
    const { user, app } = openArtifact(detail({ ...feature, sections: {} }));
    const tasks = screen.getByRole('region', { name: 'Tasks' });
    expect(within(tasks).getByText('1/3 tasks done')).toBeInTheDocument();
    expect(within(tasks).getByRole('link', { name: 'Login form' })).toHaveAttribute('href', '/c/c1/tasks/T-1');
    expect(screen.queryByRole('combobox', { name: 'Feature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();

    await user.click(within(tasks).getByRole('button', { name: 'Add task' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Feature' })).toHaveTextContent('F-1 · Login');
    await user.type(within(dialog).getByLabelText('Title'), 'Login audit');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(lastSent(app, 'artifact.create').artifact).toMatchObject({ parentId: 'F-1', title: 'Login audit' });
  });

  it('should say when a feature has no tasks yet', () => {
    openArtifact(detail({ id: 'F-9', type: 'feature', title: 'Empty' }), [...board, summary({ id: 'F-9', type: 'feature', title: 'Empty' })]);
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });
});
