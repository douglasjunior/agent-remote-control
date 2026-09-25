import { describe, expect, it } from 'vitest';
import { IWorkspacePort } from './workspace.port.js';

describe('workspace.port', () => {
  it('should define IWorkspacePort symbol for dependency injection', () => {
    expect(typeof IWorkspacePort).toBe('symbol');
    expect(IWorkspacePort.description).toBe('IWorkspacePort');
  });
});
