import { Module } from '@nestjs/common';

import { DataDirectoryService } from './services/data-directory.service.js';
import { WorkspaceDirectoryService } from './services/workspace-directory.service.js';


@Module({
  providers: [DataDirectoryService, WorkspaceDirectoryService],
  exports: [DataDirectoryService, WorkspaceDirectoryService],
})
export class PathsModule {}
