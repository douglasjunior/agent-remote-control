import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { answer, lastSent, openBoard, summary } from '../../test/artifact-fixtures.js';


const feature = summary({ id: 'F-1', type: 'feature', title: 'Login' });
const typo = summary({ id: 'T-3', title: 'Fix typo', projectName: 'site' });
const done = summary({ id: 'T-4', title: 'Shipped', status: 'done' });
const form = summary({ id: 'T-5', title: 'Login form', parentId: 'F-1' });
const landing = summary({ id: 'F-2', type: 'feature', title: 'Landing', projectName: 'site' });

// Each case mounts the whole app with its dialogs and selects, which is slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  act(() => toast.dismiss());
});

async function openDialog() {
  const user = userEvent.setup();
  const app = openBoard([feature, typo, done, form, landing]);
  await user.click(screen.getByRole('button', { name: 'New' }));
  return { user, app, dialog: await screen.findByRole('dialog') };
}

async function pick(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('ArtifactCreateDialog', () => {
  it('creates a feature in the project the user picks', async () => {
    const { user, app, dialog } = await openDialog();
    await pick(user, 'Type', 'Feature');
    expect(within(dialog).getByRole('heading', { name: 'New feature' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Feature' })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Title'), '  Checkout  ');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await pick(user, 'Project', 'site');
    await user.type(within(dialog).getByLabelText('Overview'), 'Pay online');
    await user.click(within(dialog).getByRole('switch', { name: /Business refinement/ }));
    expect(within(dialog).queryByText('A simple item: it goes straight to the Developer.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: /Technical refinement/ }));
    expect(within(dialog).getByText('A simple item: it goes straight to the Developer.')).toBeInTheDocument();
    await user.click(create);

    expect(lastSent(app, 'artifact.create').artifact).toEqual({
      type: 'feature',
      title: 'Checkout',
      projectName: 'site',
      dependsOn: [],
      sections: { overview: 'Pay online' },
      businessRefinement: false,
      technicalRefinement: false,
    });
    answer(app, 'artifact.create', { ok: true, id: 'F-2' });
    expect(await screen.findByText('F-2 created')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a task in a feature, with its project and dependencies', async () => {
    const { user, app, dialog } = await openDialog();
    expect(within(dialog).getByRole('heading', { name: 'New task' })).toBeInTheDocument();
    await pick(user, 'Feature', 'F-1 · Login');
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).toHaveTextContent('app');
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
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(lastSent(app, 'artifact.create').artifact).toEqual({
      type: 'task',
      title: 'Login API',
      parentId: 'F-1',
      dependsOn: ['T-5'],
      businessRefinement: true,
      technicalRefinement: true,
    });
    answer(app, 'artifact.create', { ok: false, error: 'Unknown feature' });
    expect(await screen.findByText('Unknown feature')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers only siblings as dependencies and drops those a new level does not share', async () => {
    const { user, app, dialog } = await openDialog();
    await pick(user, 'Add a dependency', 'T-3 · Fix typo');
    expect(within(dialog).getByText('T-3')).toBeInTheDocument();

    await pick(user, 'Feature', 'F-1 · Login');
    expect(within(dialog).queryByText('T-3')).not.toBeInTheDocument();
    await pick(user, 'Add a dependency', 'T-5 · Login form');

    await pick(user, 'Type', 'Feature');
    expect(within(dialog).queryByText('T-5')).not.toBeInTheDocument();
    await pick(user, 'Add a dependency', 'F-2 · Landing');
    await pick(user, 'Project', 'site');
    await user.type(within(dialog).getByLabelText('Title'), 'Search');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(lastSent(app, 'artifact.create').artifact).toMatchObject({ type: 'feature', projectName: 'site', dependsOn: ['F-2'] });
    expect(lastSent(app, 'artifact.create').artifact).not.toHaveProperty('parentId');
  });
});
