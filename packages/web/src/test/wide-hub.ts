import { afterEach, beforeEach, rs } from '@rstest/core';

import { HUB_WIDE_QUERY } from '../components/settings-hub/settings-sections.js';


/** Makes the settings hub lay out beside its section list, as a wide screen does, for the specs of the describe it is called in. */
export function stubWideHub() {
  const defaultMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    rs.stubGlobal('matchMedia', (query: string) => ({ matches: query === HUB_WIDE_QUERY, addEventListener: rs.fn(), removeEventListener: rs.fn() }));
  });
  afterEach(() => {
    rs.stubGlobal('matchMedia', defaultMatchMedia);
  });
}
