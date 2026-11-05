/** The vertical center of an element, in pixels from the top of the container. */
export function lensCenter(container: Element, lens: Element): number {
  const box = lens.getBoundingClientRect();
  return box.top + box.height / 2 - container.getBoundingClientRect().top;
}
