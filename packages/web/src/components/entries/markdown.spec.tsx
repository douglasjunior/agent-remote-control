import { render, screen } from '@testing-library/react';

import { Markdown } from './markdown.js';


describe('Markdown', () => {
  it('renders GitHub-flavored markdown', () => {
    render(<Markdown text={'# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item'} />);

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('item');
  });

  it('completes unfinished markdown only while the text is streaming', () => {
    const { container, rerender } = render(<Markdown text="some **bold" isAnimating />);
    expect(container).toHaveTextContent('some bold');
    expect(container).not.toHaveTextContent('**');

    rerender(<Markdown text="some **bold" />);
    expect(container).toHaveTextContent('some **bold');
  });
});
