import { useEffect, type RefObject } from 'react';


const EASING = 0.12;
const SETTLED_PIXELS = 0.5;

/**
 * Moves the `--mx` and `--my` custom properties of `element` after the pointer, easing toward it so the light glides.
 * Does nothing for touch screens and for people who prefer reduced motion.
 */
export function usePointerGlow(element: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const target = element.current;
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    const goal = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
    const position = { ...goal };
    let frame = 0;

    const paint = () => {
      target.style.setProperty('--mx', `${position.x}px`);
      target.style.setProperty('--my', `${position.y}px`);
    };

    const glide = () => {
      position.x += (goal.x - position.x) * EASING;
      position.y += (goal.y - position.y) * EASING;
      paint();
      const settled = Math.abs(goal.x - position.x) < SETTLED_PIXELS && Math.abs(goal.y - position.y) < SETTLED_PIXELS;
      frame = settled ? 0 : requestAnimationFrame(glide);
    };

    const onPointerMove = (event: PointerEvent) => {
      goal.x = event.clientX;
      goal.y = event.clientY;
      if (frame === 0) {
        frame = requestAnimationFrame(glide);
      }
    };

    paint();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(frame);
    };
  }, [element]);
}
