import { afterEach, expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';


expect.extend(jestDomMatchers);


afterEach(() => {
  cleanup();
});

class ResizeObserverStub {
  observe = rs.fn();
  unobserve = rs.fn();
  disconnect = rs.fn();
}

rs.stubGlobal('ResizeObserver', ResizeObserverStub);

rs.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: rs.fn(),
  removeEventListener: rs.fn(),
}));

Element.prototype.scrollTo = rs.fn() as unknown as typeof Element.prototype.scrollTo;
Element.prototype.scrollBy = rs.fn() as unknown as typeof Element.prototype.scrollBy;
