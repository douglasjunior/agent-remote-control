import { Module } from '@nestjs/common';

import { LocalWorkspaceFileSearchAdapter } from './adapters/local-workspace-file-search.adapter.js';
import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { IWorkspaceFileSearchPort } from './ports/workspace-file-search.port.js';
import { IWorkspacePort } from './ports/workspace.port.js';


@Module({
  providers: [
    {
      provide: IWorkspacePort,
      useClass: LocalWorkspaceAdapter,
    },
    {
      provide: IWorkspaceFileSearchPort,
      useClass: LocalWorkspaceFileSearchAdapter,
    },
  ],
  exports: [IWorkspacePort, IWorkspaceFileSearchPort],
})
export class WorkspaceModule {}
