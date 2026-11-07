import { Module } from '@nestjs/common';

import { PathsModule } from '../paths/paths.module.js';

import { LocalWorkspaceFileSearchAdapter } from './adapters/local-workspace-file-search.adapter.js';
import { LocalWorkspaceUploadAdapter } from './adapters/local-workspace-upload.adapter.js';
import { LocalWorkspaceAdapter } from './adapters/local-workspace.adapter.js';
import { IWorkspaceFileSearchPort } from './ports/workspace-file-search.port.js';
import { IWorkspaceUploadPort } from './ports/workspace-upload.port.js';
import { IWorkspacePort } from './ports/workspace.port.js';


@Module({
  imports: [PathsModule],
  providers: [
    {
      provide: IWorkspacePort,
      useClass: LocalWorkspaceAdapter,
    },
    {
      provide: IWorkspaceFileSearchPort,
      useClass: LocalWorkspaceFileSearchAdapter,
    },
    {
      provide: IWorkspaceUploadPort,
      useClass: LocalWorkspaceUploadAdapter,
    },
  ],
  exports: [IWorkspacePort, IWorkspaceFileSearchPort, IWorkspaceUploadPort],
})
export class WorkspaceModule {}
