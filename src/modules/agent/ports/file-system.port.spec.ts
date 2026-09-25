import { describe, expect, it } from 'vitest';
import { IFileSystemPort } from './file-system.port.js';

describe('file-system.port', () => {
  it('should define IFileSystemPort symbol for dependency injection', () => {
    expect(typeof IFileSystemPort).toBe('symbol');
    expect(IFileSystemPort.description).toBe('IFileSystemPort');
  });
});
