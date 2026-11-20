import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';

import { CONVERSATION_ID, detail, dragTo, lastSent, openBoard, pick, showDetail, summary } from '../../test/artifact-fixtures.js';


const held = summary({
  id: 'T-8',
  title: 'Checkout',
  status: 'in_progress',
  assignee: { role: 'DEVELOPER', roleName: 'Developer Agent', delegationId: 'd-1', since: '2026-01-01T00:00:00.000Z' },
});

function updates(app: ReturnType<typeof openBoard>) {
  return app.connection.sent.filter(command => command.type === 'artifact.update');
}


afterEach(() => {
  act(() => toast.dismiss());
});

describe('Stopping the agent working on a task', () => {
  it('should ask before a held card dropped on a status that ends the work stops its agent', async () => {
    const user = userEvent.setup();
    const app = openBoard([held]);
    await user.click(screen.getByRole('button', { name: 'Kanban' }));

    dragTo(screen.getByRole('listitem', { name: 'T-8 Checkout' }), screen.getByRole('region', { name: 'Cancelled' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Move T-8 to Cancelled?' });
    expect(dialog).toHaveTextContent('Developer is working on it right now.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep working' }));
    expect(updates(app)).toEqual([]);

    dragTo(screen.getByRole('listitem', { name: 'T-8 Checkout' }), screen.getByRole('region', { name: 'Blocked' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move and stop' }));
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-8', changes: { status: 'blocked' } });
  });

  it('should move a held card on without asking while the work goes on', async () => {
    const user = userEvent.setup();
    const app = openBoard([held]);
    await user.click(screen.getByRole('button', { name: 'Kanban' }));

    dragTo(screen.getByRole('listitem', { name: 'T-8 Checkout' }), screen.getByRole('region', { name: 'In review' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-8', changes: { status: 'in_review' } });
  });

  it('should ask on the task page before a status that ends the work stops its agent', async () => {
    const user = userEvent.setup();
    const app = openBoard([held], { path: `/c/${CONVERSATION_ID}/tasks/T-8` });
    showDetail(app, detail(held));

    await pick(user, 'Status', 'Done');
    const dialog = await screen.findByRole('alertdialog', { name: 'Move T-8 to Done?' });
    await user.click(within(dialog).getByRole('button', { name: 'Move and stop' }));

    expect(lastSent(app, 'artifact.update')).toMatchObject({ id: 'T-8', changes: { status: 'done' } });
  });
});
