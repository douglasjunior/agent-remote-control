import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { answer, CONVERSATION_ID, detail, lastSent, openBoard, showDetail, summary } from '../../test/artifact-fixtures.js';


const frozen = summary({ id: 'T-6', title: 'Login API', status: 'frozen' });
const ready = summary({ id: 'T-7', title: 'Logout', status: 'ready' });

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  };
}

function dragTo(card: HTMLElement, column: HTMLElement) {
  const transfer = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: transfer });
  fireEvent.drop(column, { dataTransfer: transfer });
}

async function pick(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

function messagesSent(app: ReturnType<typeof openBoard>) {
  return app.connection.sent.filter(command => command.type === 'message.send');
}

// Each case mounts the whole app with its dialogs and selects, which is slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  act(() => toast.dismiss());
});

describe('Unfreezing a task', () => {
  it('moves a frozen task on and hands the instruction to the coordinator', async () => {
    const user = userEvent.setup();
    const app = openBoard([frozen, ready]);
    expect(screen.getAllByText('Frozen').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Unfreeze T-6' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unfreeze T-6' });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveTextContent('Ready');

    await pick(user, 'Move to', 'Blocked');
    await user.type(within(dialog).getByLabelText('Instruction for the coordinator'), '  Split it in two  ');
    await user.click(within(dialog).getByRole('button', { name: 'Unfreeze' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-6', changes: { status: 'blocked' } });
    answer(app, 'artifact.update', { ok: true, id: 'T-6' });
    await vi.waitFor(() => expect(lastSent(app, 'artifact.comment')).toMatchObject({ id: 'T-6', text: 'Split it in two' }));
    answer(app, 'artifact.comment', { ok: true, id: 'T-6' });
    await vi.waitFor(() => expect(messagesSent(app)).toEqual([
      {
        type: 'message.send',
        conversationId: CONVERSATION_ID,
        text: 'Task T-6 "Login API" was unfrozen and moved to Blocked. Instructions: Split it in two',
      },
    ]));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the Frozen column only while a task is frozen and unfreezes from the card menu', async () => {
    const user = userEvent.setup();
    const app = openBoard([frozen, ready]);
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('region', { name: 'Frozen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move T-6' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Unfreeze…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unfreeze T-6' });
    await user.click(within(dialog).getByRole('button', { name: 'Unfreeze' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ changes: { status: 'ready' } });
    answer(app, 'artifact.update', { ok: true, id: 'T-6' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(app.connection.sent.some(command => command.type === 'artifact.comment')).toBe(false);
    expect(messagesSent(app)).toEqual([]);

    act(() => app.connection.emitEvent({ type: 'artifact.updated', conversationId: CONVERSATION_ID, artifact: { ...frozen, status: 'ready' } }));
    expect(screen.queryByRole('region', { name: 'Frozen' })).not.toBeInTheDocument();
  });

  it('asks before a frozen card dropped on another column leaves Frozen, and freezes a card dropped on Frozen', async () => {
    const user = userEvent.setup();
    const app = openBoard([frozen, ready]);
    await user.click(screen.getByRole('button', { name: 'Board' }));

    dragTo(screen.getByRole('listitem', { name: 'T-6 Login API' }), screen.getByRole('region', { name: 'In review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unfreeze T-6' });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveTextContent('In review');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    dragTo(screen.getByRole('listitem', { name: 'T-6 Login API' }), screen.getByRole('region', { name: 'Done' }));
    expect(within(await screen.findByRole('dialog')).getByRole('combobox', { name: 'Move to' })).toHaveTextContent('Ready');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(app.connection.sent.some(command => command.type === 'artifact.update')).toBe(false);

    dragTo(screen.getByRole('listitem', { name: 'T-7 Logout' }), screen.getByRole('region', { name: 'Frozen' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-7', changes: { status: 'frozen' } });
  });

  it('explains a frozen task on its page and unfreezes it from the banner or the status', async () => {
    const user = userEvent.setup();
    const app = openBoard([frozen, ready], { path: `/c/${CONVERSATION_ID}/tasks/T-6` });
    showDetail(app, detail(frozen));
    const banner = screen.getByRole('note', { name: 'Frozen' });
    expect(banner).toHaveTextContent('Frozen after too many delegations');

    await user.click(within(banner).getByRole('button', { name: 'Unfreeze' }));
    let dialog = await screen.findByRole('dialog', { name: 'Unfreeze T-6' });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveTextContent('Ready');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await pick(user, 'Status', 'Approved');
    dialog = await screen.findByRole('dialog', { name: 'Unfreeze T-6' });
    expect(within(dialog).getByRole('combobox', { name: 'Move to' })).toHaveTextContent('Approved');
    await user.type(within(dialog).getByLabelText('Instruction for the coordinator'), 'Ship it');
    await user.click(within(dialog).getByRole('button', { name: 'Unfreeze' }));
    answer(app, 'artifact.update', { ok: false, error: 'Only the user can unfreeze it' });
    expect(await screen.findByText('Only the user can unfreeze it')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Unfreeze T-6' })).toBeInTheDocument();
    expect(app.connection.sent.some(command => command.type === 'artifact.comment')).toBe(false);
    expect(messagesSent(app)).toEqual([]);
  });

  it('changes the status of a task that is not frozen directly', async () => {
    const user = userEvent.setup();
    const app = openBoard([frozen, ready], { path: `/c/${CONVERSATION_ID}/tasks/T-7` });
    showDetail(app, detail(ready));
    expect(screen.queryByRole('note', { name: 'Frozen' })).not.toBeInTheDocument();
    await pick(user, 'Status', 'Frozen');
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-7', changes: { status: 'frozen' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
