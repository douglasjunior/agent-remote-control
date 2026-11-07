import { describe, expect, it } from 'vitest';

import { IProcessRunnerPort } from './process-runner.port.js';


describe('process-runner.port', () => {
  it('should define IProcessRunnerPort symbol for dependency injection', () => {
    expect(typeof IProcessRunnerPort).toBe('symbol');
    expect(IProcessRunnerPort.description).toBe('IProcessRunnerPort');
  });
});
