/** `a`, `a and b`, `a, b and c`: the items as one phrase of a sentence. */
export function formatWordList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
