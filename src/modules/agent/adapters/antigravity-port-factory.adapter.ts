import { Inject, Injectable } from '@nestjs/common';

import { IAgentPortFactory } from '../ports/agent-port-factory.port.js';
import type { IAgentPort } from '../ports/agent.port.js';
import { IFileSystemPort } from '../ports/file-system.port.js';
import { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AntigravityAdapter } from './antigravity.adapter.js';


@Injectable()
export class AntigravityPortFactoryAdapter implements IAgentPortFactory {
  constructor(
    @Inject(IFileSystemPort)
    private readonly fileSystem: IFileSystemPort,
    @Inject(IProcessRunnerPort)
    private readonly processRunner: IProcessRunnerPort,
  ) {}

  create(): IAgentPort {
    return new AntigravityAdapter(this.fileSystem, this.processRunner);
  }
}
