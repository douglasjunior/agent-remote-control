import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';


afterEach(() => {
  cleanup();
});

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
