import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { toast } from 'sonner';

import { ArtifactsProvider } from '../../artifacts/artifacts-context.js';
import { ConnectionProvider } from '../../connection/connection-context.js';
import { answer, CONVERSATION_ID, lastSent, openBoard, pick, summary } from '../../test/artifact-fixtures.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';
import { ThemeProvider } from '../../theme/theme-provider.js';
import { Toaster } from '../ui/sonner.js';

import { ArtifactCreateDialog } from './artifact-create-dialog.js';


const feature = summary({ id: 'F-1', type: 'feature', title: 'Login' });
const typo = summary({ id: 'T-3', title: 'Fix typo', projectName: 'site' });
const done = summary({ id: 'T-4', title: 'Shipped', status: 'done' });
const form = summary({ id: 'T-5', title: 'Login form', parentId: 'F-1' });
const landing = summary({ id: 'F-2', type: 'feature', title: 'Landing', projectName: 'site' });
const shared = summary({ id: 'F-3', type: 'feature', title: 'Shared', projectNames: ['app', 'site'] });
const ARTIFACTS = [feature, typo, done, form, landing, shared];


afterEach(() => {
  act(() => toast.dismiss());
});

function OpenDialog() {
  const [open, setOpen] = useState(true);
  return <ArtifactCreateDialog conversationId={CONVERSATION_ID} open={open} onOpenChange={setOpen} />;
}

/** The dialog over the board of the conversation, without the rest of the app around it. */
async function openDialog() {
  const user = userEvent.setup();
  const connection = new FakeServerConnection();
  render(
    <ThemeProvider>
      <ConnectionProvider connection={connection}>
        <ArtifactsProvider>
          <OpenDialog />
          <Toaster />
        </ArtifactsProvider>
      </ConnectionProvider>
    </ThemeProvider>,
  );
  act(() => {
    connection.emitStatus('open');
    connection.emitEvent({ type: 'artifacts.list', conversationId: CONVERSATION_ID, artifacts: [...ARTIFACTS] });
    connection.emitEvent({ type: 'projects.list', projects: ['app', 'site'] });
  });
  return { user, app: { connection }, dialog: await screen.findByRole('dialog') };
}

async function pickProject(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('ArtifactCreateDialog', () => {
  it('should open from the board, as a new task', async () => {
    const user = userEvent.setup();
    openBoard(ARTIFACTS);

    await user.click(screen.getByRole('button', { name: 'New' }));

    expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: 'New task' })).toBeInTheDocument();
  });

  it('should create a feature in the projects the user picks', async () => {
    const { user, app, dialog } = await openDialog();
    await pick(user, 'Type', 'Feature');
    expect(within(dialog).getByRole('heading', { name: 'New feature' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Feature' })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Title'), '  Checkout  ');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    expect(within(dialog).queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();
    await pickProject(user, 'Projects', 'site');
    expect(create).toBeEnabled();
    await user.type(within(dialog).getByLabelText('Overview'), 'Pay online');
    expect(within(dialog).getByRole('switch', { name: /Design refinement/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('switch', { name: /Business refinement/ }));
    expect(within(dialog).queryByText('A simple item: it goes straight to the Developer.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: /Technical refinement/ }));
    expect(within(dialog).getByText('A simple item: it goes straight to the Developer.')).toBeInTheDocument();
    await user.click(create);

    expect(lastSent(app, 'artifact.create').artifact).toEqual({
      type: 'feature',
      title: 'Checkout',
      projectNames: ['site'],
      dependsOn: [],
      sections: { overview: 'Pay online' },
      refinements: { business: false, design: false, technical: false },
    });
    await answer(app, 'artifact.create', { ok: true, id: 'F-2' });
    expect(await screen.findByText('F-2 created')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should create a task in a feature, with its project and dependencies', async () => {
    const { user, app, dialog } = await openDialog();
    expect(within(dialog).getByRole('heading', { name: 'New task' })).toBeInTheDocument();
    await pick(user, 'Feature', 'F-1 · Login');
    expect(within(dialog).queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('app')).toBeInTheDocument();
    expect(within(dialog).getByText('The project of its feature.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('combobox', { name: 'Add a dependency' }));
    expect(screen.queryByRole('option', { name: 'T-3 · Fix typo' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'T-5 · Login form' }));
    expect(within(dialog).getByText('T-5')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Add a dependency' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove dependency T-5' }));
    expect(within(dialog).queryByText('T-5')).not.toBeInTheDocument();
    await pick(user, 'Add a dependency', 'T-5 · Login form');

    await user.type(within(dialog).getByLabelText('Title'), 'Login API');
    await user.click(within(dialog).getByRole('switch', { name: /Design refinement/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(lastSent(app, 'artifact.create').artifact).toEqual({
      type: 'task',
      title: 'Login API',
      parentId: 'F-1',
      projectName: 'app',
      dependsOn: ['T-5'],
      refinements: { business: true, design: true, technical: true },
    });
    await answer(app, 'artifact.create', { ok: false, error: 'Unknown feature' });
    expect(await screen.findByText('Unknown feature')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should offer only siblings as dependencies and drop those a new level does not share', async () => {
    const { user, app, dialog } = await openDialog();
    await pick(user, 'Add a dependency', 'T-3 · Fix typo');
    expect(within(dialog).getByText('T-3')).toBeInTheDocument();

    await pick(user, 'Feature', 'F-1 · Login');
    expect(within(dialog).queryByText('T-3')).not.toBeInTheDocument();
    await pick(user, 'Add a dependency', 'T-5 · Login form');

    await pick(user, 'Type', 'Feature');
    expect(within(dialog).queryByText('T-5')).not.toBeInTheDocument();
    await pick(user, 'Add a dependency', 'F-2 · Landing');
    await pickProject(user, 'Projects', 'site');
    await user.type(within(dialog).getByLabelText('Title'), 'Search');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(lastSent(app, 'artifact.create').artifact).toMatchObject({ type: 'feature', projectNames: ['site'], dependsOn: ['F-2'] });
    expect(lastSent(app, 'artifact.create').artifact).not.toHaveProperty('parentId');
  });

  it('should create a feature that links several projects, and keep at least one picked to create it', async () => {
    const { user, app, dialog } = await openDialog();
    await pick(user, 'Type', 'Feature');
    expect(within(dialog).getByPlaceholderText('Choose projects')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Title'), 'Checkout');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();

    await pickProject(user, 'Projects', 'site');
    await pickProject(user, 'Projects', 'app');
    expect(screen.queryByPlaceholderText('Choose projects')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove site' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove app' }));
    expect(create).toBeDisabled();
    await pickProject(user, 'Projects', 'site');
    await pickProject(user, 'Projects', 'app');
    await user.click(create);

    expect(lastSent(app, 'artifact.create').artifact).toMatchObject({ type: 'feature', projectNames: ['site', 'app'] });
  });

  it('should ask for one of the projects of a feature that links several, with none preselected', async () => {
    const { user, app, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText('Title'), 'Search');
    await pickProject(user, 'Project', 'site');
    await pick(user, 'Feature', 'F-3 · Shared');

    const project = within(dialog).getByRole('combobox', { name: 'Project' });
    expect(project).toHaveTextContent('Choose a project');
    expect(within(dialog).getByText('One of the projects of its feature.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.click(project);
    expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['Choose a project', 'app', 'site']);
    await user.click(screen.getByRole('option', { name: 'site' }));
    expect(project).toHaveTextContent('site');
    expect(screen.queryByRole('option', { name: 'Choose a project' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(lastSent(app, 'artifact.create').artifact).toMatchObject({ type: 'task', parentId: 'F-3', projectName: 'site' });
  });
});
