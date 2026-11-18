import { rs } from '@rstest/core';

import type { RetryListener } from '../models/turn-retry.model.js';


export function retryListener(overrides: Partial<RetryListener> = {}): RetryListener {
  return { scheduled: rs.fn(), ended: rs.fn(), ...overrides };
}
