import { describe, expect, it } from 'vitest';

import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AntigravityPortFactoryAdapter } from './antigravity-port-factory.adapter.js';
import { AntigravityAdapter } from './antigravity.adapter.js';


describe('AntigravityPortFactoryAdapter', () => {
  it('should create an AntigravityAdapter', () => {
    const fileSystem = {} as IFileSystemPort;
    const processRunner = {} as IProcessRunnerPort;
    const factory = new AntigravityPortFactoryAdapter(fileSystem, processRunner);
    const agentPort = factory.create();
    expect(agentPort).toBeInstanceOf(AntigravityAdapter);
  });
});
