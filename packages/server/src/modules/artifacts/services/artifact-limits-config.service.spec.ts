import { afterEach, describe, expect, it, rs } from '@rstest/core';

import { ArtifactLimitsConfigService } from './artifact-limits-config.service.js';


describe('ArtifactLimitsConfigService', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it.each([
    [undefined, 25],
    ['  ', 25],
    ['40', 40],
    ['7.9', 7],
    ['0', 0],
    ['-1', 25],
    ['many', 25],
  ])('should read ARTIFACT_MAX_DELEGATIONS=%j as %d', (raw, expected) => {
    if (raw !== undefined) {
      rs.stubEnv('ARTIFACT_MAX_DELEGATIONS', raw);
    }

    expect(new ArtifactLimitsConfigService().getMaxDelegations()).toBe(expected);
  });
});
