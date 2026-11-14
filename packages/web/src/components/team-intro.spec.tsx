import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TeamIntro } from './team-intro.js';


describe('TeamIntro', () => {
  it('introduces every member of the team with what it does', () => {
    render(<TeamIntro onPick={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Meet your team' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('Writes the code')).toBeInTheDocument();
  });

  it('offers the example request of the member that was picked', async () => {
    const onPick = vi.fn();
    render(<TeamIntro onPick={onPick} />);

    await userEvent.click(screen.getByRole('button', { name: /Developer/ }));

    expect(onPick).toHaveBeenCalledWith('Fix the failing tests');
  });
});
