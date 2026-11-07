import { afterEach, describe, expect, it } from 'vitest';

import { QuestionTimeoutConfigService } from './question-timeout-config.service.js';


describe('QuestionTimeoutConfigService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should default to five minutes', () => {
    delete process.env.QUESTION_TIMEOUT_MS;

    expect(new QuestionTimeoutConfigService().getTimeoutMs()).toBe(300_000);
  });

  it('should read the timeout from the environment', () => {
    process.env.QUESTION_TIMEOUT_MS = ' 1500 ';

    expect(new QuestionTimeoutConfigService().getTimeoutMs()).toBe(1500);
  });

  it('should allow zero to disable the timeout', () => {
    process.env.QUESTION_TIMEOUT_MS = '0';

    expect(new QuestionTimeoutConfigService().getTimeoutMs()).toBe(0);
  });

  it.each(['abc', '-5', 'Infinity'])('should fall back to the default for %s', (value) => {
    process.env.QUESTION_TIMEOUT_MS = value;

    expect(new QuestionTimeoutConfigService().getTimeoutMs()).toBe(300_000);
  });
});
