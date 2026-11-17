import { fireEvent, render, screen } from '@testing-library/react';

import { FileMentionPopup } from './file-mention-popup.js';


const items = [
  { path: 'app/', kind: 'directory' as const, matches: [0, 1] },
  { path: 'site/app/components/button.tsx', kind: 'file' as const, matches: [0, 5, 9, 10] },
];

function setup(highlightedIndex = 0, isWalking = false) {
  const onAccept = rs.fn();
  const onHighlightChange = rs.fn();
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
  it('should list the paths as options and mark the highlighted one', () => {
    setup(1);

    const options = screen.getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['app/', 'site/app/components/button.tsx']);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('listbox', { name: 'Files' })).toHaveAttribute('id', 'list');
  });

  it('should highlight the matched characters, in the folder part and in the name', () => {
    setup();
    const [directory, file] = screen.getAllByRole('option');

    expect(highlighted(directory)).toEqual(['ap']);
    expect(highlighted(file)).toEqual(['s', 'a', 'co']);
  });

  it('should show the position and no spinner once the walk is over', () => {
    setup(1);

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.queryByTestId('walking-spinner')).not.toBeInTheDocument();
  });

  it('should show a spinner while the server still walks the workspace', () => {
    setup(0, true);

    expect(screen.getByTestId('walking-spinner')).toBeInTheDocument();
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it('should accept the clicked option', () => {
    const { onAccept } = setup();

    fireEvent.click(screen.getAllByRole('option')[1]);

    expect(onAccept).toHaveBeenCalledWith(items[1]);
  });

  it('should highlight the option under the pointer', () => {
    const { onHighlightChange } = setup();

    fireEvent.mouseMove(screen.getAllByRole('option')[1]);

    expect(onHighlightChange).toHaveBeenCalledWith(1);
  });

  it('should keep the focus in the field on mouse down', () => {
    setup();

    expect(fireEvent.mouseDown(screen.getAllByRole('option')[0])).toBe(false);
  });

  it('should scroll the highlighted option into view', () => {
    const scrollIntoView = rs.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    setup(1);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
});
