import { render } from '@testing-library/react';
import { useRef } from 'react';

import { usePointerGlow } from './use-pointer-glow.js';


function Glow() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerGlow(ref);
  return <div ref={ref} data-testid="glow" />;
}

const mediaMatches = (matching: readonly string[]) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: matching.includes(query),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

describe('usePointerGlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mediaMatches([]);
  });

  it('starts near the top center of the window', () => {
    mediaMatches([]);
    const { getByTestId } = render(<Glow />);

    expect(getByTestId('glow').style.getPropertyValue('--mx')).toBe('500px');
    expect(getByTestId('glow').style.getPropertyValue('--my')).toBe('200px');
  });

  it('glides toward the pointer and settles on it', () => {
    mediaMatches([]);
    const { getByTestId } = render(<Glow />);
    const glow = getByTestId('glow');

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(32);
    const midway = Number.parseFloat(glow.style.getPropertyValue('--mx'));
    expect(midway).toBeLessThan(500);
    expect(midway).toBeGreaterThan(100);

    vi.advanceTimersByTime(5000);
    expect(Number.parseFloat(glow.style.getPropertyValue('--mx'))).toBeCloseTo(100, 0);
    expect(Number.parseFloat(glow.style.getPropertyValue('--my'))).toBeCloseTo(100, 0);
  });

  it('keeps one animation going while the pointer moves', () => {
    mediaMatches([]);
    const request = vi.spyOn(window, 'requestAnimationFrame');
    render(<Glow />);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20 }));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([['(prefers-reduced-motion: reduce)'], ['(pointer: coarse)']])('stays still when %s', (query) => {
    mediaMatches([query]);
    const { getByTestId } = render(<Glow />);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(1000);

    expect(getByTestId('glow').style.getPropertyValue('--mx')).toBe('');
  });

  it('stops listening when it unmounts', () => {
    mediaMatches([]);
    const request = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = render(<Glow />);
    unmount();

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 }));

    expect(request).not.toHaveBeenCalled();
  });
});
