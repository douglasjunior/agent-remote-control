import { Module } from '@nestjs/common';
import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { SimpleGitAdapter } from './adapters/simple-git.adapter.js';
import { IGitPort } from './ports/git.port.js';
import { IWorkspacePort } from './ports/workspace.port.js';
import { PrepareWorkspaceUseCase } from './use-cases/prepare-workspace.use-case.js';

@Module({
  providers: [
    {
      provide: IGitPort,
      useClass: SimpleGitAdapter,
    },
    {
      provide: IWorkspacePort,
      useClass: LocalWorkspaceAdapter,
    },
    PrepareWorkspaceUseCase,
  ],
  exports: [IGitPort, IWorkspacePort, PrepareWorkspaceUseCase],
})
export class WorkspaceModule {}
