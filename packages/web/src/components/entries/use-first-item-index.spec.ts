import { renderHook } from '@testing-library/react';

import { useFirstItemIndex } from './use-first-item-index.js';


function track(initial: readonly string[]) {
  return renderHook(({ ids }) => useFirstItemIndex(ids), { initialProps: { ids: initial } });
}

describe('useFirstItemIndex', () => {
  it('should drop by the number of items added at the top and stay when items come at the end', () => {
    const { result, rerender } = track(['c', 'd']);
    const base = result.current;

    rerender({ ids: ['c', 'd', 'e'] });
    expect(result.current).toBe(base);

    rerender({ ids: ['a', 'b', 'c', 'd', 'e'] });
    expect(result.current).toBe(base - 2);
  });

  it('should count from the first item both lists share when the top one changed its id', () => {
    const { result, rerender } = track(['group:c', 'd']);
    const base = result.current;

    rerender({ ids: ['a', 'group:b', 'd'] });

    expect(result.current).toBe(base - 1);
  });

  it('should stay when the list shares no item with the one before', () => {
    const { result, rerender } = track(['a']);
    const base = result.current;

    rerender({ ids: ['x', 'y'] });

    expect(result.current).toBe(base);
  });
});
