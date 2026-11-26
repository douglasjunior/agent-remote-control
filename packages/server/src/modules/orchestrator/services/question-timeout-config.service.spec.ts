import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { QuestionTimeoutConfigService } from './question-timeout-config.service.js';


describe('QuestionTimeoutConfigService', () => {
  it('should default to five minutes', () => {
    expect(new QuestionTimeoutConfigService(new StubRuntimeSettings()).getTimeoutMs()).toBe(300_000);
  });

  it('should read the timeout from the settings, where zero disables it', () => {
    const settings = new StubRuntimeSettings({ QUESTION_TIMEOUT_MS: 1500 });
    const config = new QuestionTimeoutConfigService(settings);

    expect(config.getTimeoutMs()).toBe(1500);
    settings.set('QUESTION_TIMEOUT_MS', 0);
    expect(config.getTimeoutMs()).toBe(0);
  });
});
