import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { ArtifactLimitsConfigService } from './artifact-limits-config.service.js';


describe('ArtifactLimitsConfigService', () => {
  it('should default to 25 delegations', () => {
    expect(new ArtifactLimitsConfigService(new StubRuntimeSettings()).getMaxDelegations()).toBe(25);
  });

  it('should read the limit from the settings, where zero disables it', () => {
    expect(new ArtifactLimitsConfigService(new StubRuntimeSettings({ ARTIFACT_MAX_DELEGATIONS: 0 })).getMaxDelegations()).toBe(0);
  });
});
