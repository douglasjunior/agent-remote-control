import { fireEvent, render, screen } from '@testing-library/react';

import { FileMentionPopup } from './file-mention-popup.js';


const items = [
  { path: 'app/', kind: 'directory' as const, matches: [0, 1] },
  { path: 'site/app/components/button.tsx', kind: 'file' as const, matches: [0, 5, 9, 10] },
];

function setup(highlightedIndex = 0, isWalking = false) {
  const onAccept = vi.fn();
  const onHighlightChange = vi.fn();
  render(
    <FileMentionPopup
      id="list"
      items={items}
      highlightedIndex={highlightedIndex}
      isWalking={isWalking}
      optionId={index => `opt-${index}`}
      onHighlightChange={onHighlightChange}
      onAccept={onAccept}
    />,
  );
  return { onAccept, onHighlightChange };
}

const highlighted = (option: HTMLElement) =>
  [...option.querySelectorAll('span.text-primary')].map(span => span.textContent);

describe('FileMentionPopup', () => {
  it('lists the paths as options and marks the highlighted one', () => {
    setup(1);

    const options = screen.getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['app/', 'site/app/components/button.tsx']);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('listbox', { name: 'Files' })).toHaveAttribute('id', 'list');
  });

  it('highlights the matched characters, in the folder part and in the name', () => {
    setup();
    const [directory, file] = screen.getAllByRole('option');

    expect(highlighted(directory)).toEqual(['ap']);
    expect(highlighted(file)).toEqual(['s', 'a', 'co']);
  });

  it('shows the position and no spinner once the walk is over', () => {
    setup(1);

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.queryByTestId('walking-spinner')).not.toBeInTheDocument();
  });

  it('shows a spinner while the server still walks the workspace', () => {
    setup(0, true);

    expect(screen.getByTestId('walking-spinner')).toBeInTheDocument();
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it('accepts the clicked option', () => {
    const { onAccept } = setup();

    fireEvent.click(screen.getAllByRole('option')[1]);

    expect(onAccept).toHaveBeenCalledWith(items[1]);
  });

  it('highlights the option under the pointer', () => {
    const { onHighlightChange } = setup();

    fireEvent.mouseMove(screen.getAllByRole('option')[1]);

    expect(onHighlightChange).toHaveBeenCalledWith(1);
  });

  it('keeps the focus in the field on mouse down', () => {
    setup();

    expect(fireEvent.mouseDown(screen.getAllByRole('option')[0])).toBe(false);
  });

  it('scrolls the highlighted option into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    setup(1);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
});
