import { useLayoutEffect, useRef, type RefObject } from 'react';

import { lensCenter } from './lens-center.js';


/**
 * Draws the neutral vertical spine through the centers of the lenses, from the first to the last. The spine implies no
 * order of work: involvement shows only on each station. It is positioned on the DOM directly, from measured positions,
 * so a station that changes height only costs a measurement.
 */
export function useSquadSpine(stations: RefObject<HTMLElement | null>, count: number) {
  const spine = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = stations.current!;
    const spineEl = spine.current!;
    const measure = () => {
      const lenses = container.querySelectorAll<HTMLElement>('[data-lens]');
      const top = lensCenter(container, lenses[0]!);
      spineEl.style.top = `${top}px`;
      spineEl.style.height = `${lensCenter(container, lenses[count - 1]!) - top}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [stations, count]);

  return spine;
}
