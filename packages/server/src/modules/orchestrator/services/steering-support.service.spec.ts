import { describe, expect, it } from '@rstest/core';

import { SteeringSupportService } from './steering-support.service.js';


describe('SteeringSupportService', () => {
  it('should know nothing of an agent no port has connected to', () => {
    expect(new SteeringSupportService().supports('claude')).toBeUndefined();
  });

  it('should keep what the last connection to each agent said', () => {
    const steering = new SteeringSupportService();

    steering.record('claude', true);
    steering.record('copilot', false);
    steering.record('claude', false);

    expect(steering.supports('claude')).toBe(false);
    expect(steering.supports('copilot')).toBe(false);
  });
});
