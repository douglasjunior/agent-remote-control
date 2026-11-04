import { Module } from '@nestjs/common';

import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { IWorkspacePort } from './ports/workspace.port.js';


@Module({
  providers: [
    {
      provide: IWorkspacePort,
      useClass: LocalWorkspaceAdapter,
    },
  ],
  exports: [IWorkspacePort],
})
export class WorkspaceModule {}
