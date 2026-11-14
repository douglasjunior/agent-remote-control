import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { CONVERSATION_ID, lastSent, openBoard, summary } from '../../test/artifact-fixtures.js';
import { AT, renderApp } from '../../test/render-app.js';


const at = AT;
const feature = summary({ id: 'F-1', type: 'feature', title: 'Login', status: 'in_progress' });
const form = summary({ id: 'T-1', title: 'Login form', parentId: 'F-1', status: 'done', pullRequests: [{ url: 'https://example.com/1', state: 'merged', addedAt: at }] });
const api = summary({
  id: 'T-2',
  title: 'Login API',
  parentId: 'F-1',
  status: 'in_progress',
  dependsOn: ['T-1', 'T-9'],
  assignee: { role: 'DEVELOPER', roleName: 'Developer', delegationId: 'd1', since: at },
});
const typo = summary({ id: 'T-3', title: 'Fix typo', projectName: 'site', status: 'ready' });
const old = summary({ id: 'T-4', title: 'Old idea', projectName: 'site', status: 'cancelled' });
const artifacts = [feature, form, api, typo, old];

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
}

// Each case mounts the whole app with its dialogs and selects, which is slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  act(() => toast.dismiss());
});

describe('ArtifactBoard', () => {
  it('waits for the board of the conversation, which the conversation asks for', () => {
    const app = renderApp(`/c/${CONVERSATION_ID}/tasks`);
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument();
    expect(app.connection.sent).toContainEqual({ type: 'artifacts.list', conversationId: CONVERSATION_ID });
  });

  it('invites to create the first task', async () => {
    const user = userEvent.setup();
    openBoard([]);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument();
  });

  it('lists each project with its features, their tasks and the standalone tasks', () => {
    openBoard(artifacts);
    const app = screen.getByRole('list', { name: 'Features of app' });
    expect(within(app).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/c/c1/tasks/F-1');
    expect(within(app).getByRole('link', { name: 'Login form' })).toBeInTheDocument();
    expect(within(app).getByTitle('1 of 2 tasks done')).toBeInTheDocument();
    expect(within(app).getByLabelText('Waiting on T-9')).toBeInTheDocument();
    expect(within(app).getByLabelText('1 pull request')).toBeInTheDocument();
    expect(within(app).getByRole('img', { name: 'Developer, working' })).toBeInTheDocument();
    const site = screen.getByRole('list', { name: 'Standalone tasks of site' });
    expect(within(site).getByRole('link', { name: 'Fix typo' })).toBeInTheDocument();
    expect(screen.getByText('Standalone tasks')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('collapses and expands a feature', async () => {
    const user = userEvent.setup();
    openBoard(artifacts);
    await user.click(screen.getByRole('button', { name: 'Collapse F-1' }));
    expect(screen.queryByRole('link', { name: 'Login form' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand F-1' }));
    expect(screen.getByRole('link', { name: 'Login form' })).toBeInTheDocument();
  });

  it('filters by text, project, type and closed status', async () => {
    const user = userEvent.setup();
    openBoard(artifacts);
    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'typo');
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix typo' })).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Search tasks' }));

    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'app' }));
    expect(screen.queryByRole('link', { name: 'Fix typo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'All projects' }));

    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Features' }));
    expect(screen.queryByRole('link', { name: 'Fix typo' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Features and tasks' }));

    expect(screen.getByRole('link', { name: 'Old idea' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch'));
    expect(screen.queryByRole('link', { name: 'Old idea' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'nothing like this');
    expect(screen.getByText('Nothing matches the filters.')).toBeInTheDocument();
  });

  it('shows the tasks on a board by status and remembers the view', async () => {
    const user = userEvent.setup();
    openBoard(artifacts);
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('arc.artifactsBoard')).toBe('true');
    expect(screen.queryByRole('combobox', { name: 'Type' })).not.toBeInTheDocument();

    const columns = ['Backlog', 'Ready', 'In progress', 'In review', 'Changes requested', 'Approved', 'In testing', 'Done', 'Blocked', 'Cancelled'];
    expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label')).filter(label => columns.includes(label!))).toEqual(columns);
    const progress = screen.getByRole('region', { name: 'In progress' });
    expect(within(progress).getByRole('listitem', { name: 'T-2 Login API' })).toBeInTheDocument();
    expect(within(progress).getByText('Login')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('Login form')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Cancelled' })).getByText('Old idea')).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'F-1 Login' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch'));
    expect(screen.queryByRole('region', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cancelled' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blocked' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('list', { name: 'Features of app' })).toBeInTheDocument();
  });

  it('moves a task by dropping it on a column', async () => {
    const app = openBoard(artifacts);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Board' }));
    const card = screen.getByRole('listitem', { name: 'T-3 Fix typo' });
    const review = screen.getByRole('region', { name: 'In review' });
    const transfer = dataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe('move');
    fireEvent.dragOver(review, { dataTransfer: transfer });
    expect(review).toHaveAttribute('data-drop-target', 'true');
    fireEvent.dragLeave(screen.getByRole('region', { name: 'Ready' }));
    expect(review).toHaveAttribute('data-drop-target', 'true');
    fireEvent.dragLeave(review);
    expect(review).toHaveAttribute('data-drop-target', 'false');
    fireEvent.drop(review, { dataTransfer: transfer });
    expect(lastSent(app, 'artifact.update')).toMatchObject({ conversationId: CONVERSATION_ID, id: 'T-3', changes: { status: 'in_review' } });

    const count = app.connection.sent.length;
    fireEvent.drop(screen.getByRole('region', { name: 'Ready' }), { dataTransfer: transfer });
    fireEvent.drop(review, { dataTransfer: dataTransfer() });
    expect(app.connection.sent).toHaveLength(count);
  });

  it('moves a task from its menu', async () => {
    const user = userEvent.setup();
    const app = openBoard(artifacts);
    await user.click(screen.getByRole('button', { name: 'Board' }));
    await user.click(screen.getByRole('button', { name: 'Move T-3' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Blocked' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-3', changes: { status: 'blocked' } });
  });

  it('shows the features on the board, with their tasks and dependencies, and moves them like tasks', async () => {
    const user = userEvent.setup();
    const reports = summary({ id: 'F-2', type: 'feature', title: 'Reports', status: 'backlog', dependsOn: ['F-1'], projectName: 'site', assignee: { role: 'PRODUCT_OWNER', roleName: 'Product Owner', delegationId: 'd2', since: at } });
    const app = openBoard([...artifacts, reports]);
    expect(screen.queryByRole('group', { name: 'Board of' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Features' }));
    expect(localStorage.getItem('arc.artifactsBoardFeatures')).toBe('true');

    expect(screen.queryByRole('listitem', { name: 'T-2 Login API' })).not.toBeInTheDocument();
    const login = within(screen.getByRole('region', { name: 'In progress' })).getByRole('listitem', { name: 'F-1 Login' });
    expect(within(login).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/c/c1/tasks/F-1');
    expect(within(login).getByRole('img', { name: '1 of 2 tasks done: 1 in progress, 1 done' })).toBeInTheDocument();
    const reportsCard = within(screen.getByRole('region', { name: 'Backlog' })).getByRole('listitem', { name: 'F-2 Reports' });
    expect(within(reportsCard).getByText('No tasks yet')).toBeInTheDocument();
    expect(within(reportsCard).getByLabelText('Waiting on F-1')).toBeInTheDocument();
    expect(within(reportsCard).getByRole('img', { name: 'Product Owner, working' })).toBeInTheDocument();
    expect(within(reportsCard).getByText('site')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move F-2' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Ready' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'F-2', changes: { status: 'ready' } });

    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'reports');
    expect(screen.queryByRole('listitem', { name: 'F-1 Login' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.queryByRole('listitem', { name: 'F-2 Reports' })).not.toBeInTheDocument();
  });
});
