import { describe, expect, it } from 'vitest';
import { IGitPort } from './git.port.js';

describe('git.port', () => {
  it('should define IGitPort symbol for dependency injection', () => {
    expect(typeof IGitPort).toBe('symbol');
    expect(IGitPort.description).toBe('IGitPort');
  });
});
