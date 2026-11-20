import { afterEach, describe, expect, it } from '@rstest/core';

import { DelegationLimitsConfigService } from './delegation-limits-config.service.js';


describe('DelegationLimitsConfigService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getMaxSpecChars', () => {
    it('should default to 600', () => {
      delete process.env.DELEGATION_SPEC_MAX_CHARS;

      expect(new DelegationLimitsConfigService().getMaxSpecChars()).toBe(600);
    });

    it('should read the limit from the environment', () => {
      process.env.DELEGATION_SPEC_MAX_CHARS = ' 250 ';

      expect(new DelegationLimitsConfigService().getMaxSpecChars()).toBe(250);
    });

    it('should allow zero to disable the limit', () => {
      process.env.DELEGATION_SPEC_MAX_CHARS = '0';

      expect(new DelegationLimitsConfigService().getMaxSpecChars()).toBe(0);
    });

    it.each(['abc', '-5', '1.5'])('should fall back to the default for %s', (value) => {
      process.env.DELEGATION_SPEC_MAX_CHARS = value;

      expect(new DelegationLimitsConfigService().getMaxSpecChars()).toBe(600);
    });
  });

  describe('getMaxResultChars', () => {
    it('should default to 2000', () => {
      delete process.env.AGENT_RESULT_MAX_CHARS;

      expect(new DelegationLimitsConfigService().getMaxResultChars()).toBe(2000);
    });

    it('should read the limit from the environment', () => {
      process.env.AGENT_RESULT_MAX_CHARS = '4000';

      expect(new DelegationLimitsConfigService().getMaxResultChars()).toBe(4000);
    });

    it('should allow zero to disable the cut', () => {
      process.env.AGENT_RESULT_MAX_CHARS = '0';

      expect(new DelegationLimitsConfigService().getMaxResultChars()).toBe(0);
    });

    it.each(['abc', '-5', '1.5'])('should fall back to the default for %s', (value) => {
      process.env.AGENT_RESULT_MAX_CHARS = value;

      expect(new DelegationLimitsConfigService().getMaxResultChars()).toBe(2000);
    });
  });
});
