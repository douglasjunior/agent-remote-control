import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { DelegationLimitsConfigService } from './delegation-limits-config.service.js';


describe('DelegationLimitsConfigService', () => {
  it('should default to specifications of 600 characters and results of 2000', () => {
    const limits = new DelegationLimitsConfigService(new StubRuntimeSettings());

    expect(limits.getMaxSpecChars()).toBe(600);
    expect(limits.getMaxResultChars()).toBe(2000);
  });

  it('should read both limits from the settings, where zero disables them', () => {
    const limits = new DelegationLimitsConfigService(new StubRuntimeSettings({ DELEGATION_SPEC_MAX_CHARS: 0, AGENT_RESULT_MAX_CHARS: 250 }));

    expect(limits.getMaxSpecChars()).toBe(0);
    expect(limits.getMaxResultChars()).toBe(250);
  });
});
