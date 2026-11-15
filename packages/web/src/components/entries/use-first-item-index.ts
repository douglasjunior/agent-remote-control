import { useState } from 'react';


/** Far from 0, so the list can grow at the top for as long as the history is. */
const BASE_INDEX = 1_000_000_000;

/**
 * The `firstItemIndex` of a Virtuoso list whose items can grow at the top: it drops by the number of items that came
 * before the ones already shown, so the list keeps the reader where they are. An item whose id changed (a group that
 * took in earlier steps) is skipped in favor of the next one both lists share.
 */
export function useFirstItemIndex(ids: readonly string[]): number {
  const [previous, setPrevious] = useState({ ids, first: BASE_INDEX });
  if (previous.ids === ids) {
    return previous.first;
  }
  const first = previous.first - prependedCount(previous.ids, ids);
  setPrevious({ ids, first });
  return first;
}

function prependedCount(before: readonly string[], after: readonly string[]): number {
  const positions = new Map(after.map((id, index) => [id, index]));
  for (const [index, id] of before.entries()) {
    const position = positions.get(id);
    if (position !== undefined) {
      return Math.max(0, position - index);
    }
  }
  return 0;
}
