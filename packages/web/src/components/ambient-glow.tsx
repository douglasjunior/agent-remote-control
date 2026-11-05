import { useRef } from 'react';

import { usePointerGlow } from '../lib/use-pointer-glow.js';


/** A discreet light behind the page that follows the pointer, tinted by `--glow-color` when it is set. */
export function AmbientGlow() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerGlow(ref);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(520px_circle_at_var(--mx,50%)_var(--my,30%),color-mix(in_oklab,var(--glow-color,var(--primary))_9%,transparent),transparent_70%)] transition-[background-color] duration-700"
    />
  );
}
