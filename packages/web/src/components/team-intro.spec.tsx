import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TeamIntro } from './team-intro.js';


describe('TeamIntro', () => {
  it('should introduce every member of the team with what it does', () => {
    render(<TeamIntro onPick={rs.fn()} />);

    expect(screen.getByRole('heading', { name: 'Meet your team' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('Writes the code')).toBeInTheDocument();
  });

  it('should offer the example request of the member that was picked', async () => {
    const onPick = rs.fn();
    render(<TeamIntro onPick={onPick} />);

    await userEvent.click(screen.getByRole('button', { name: /Developer/ }));

    expect(onPick).toHaveBeenCalledWith('Fix the failing tests');
  });
});
