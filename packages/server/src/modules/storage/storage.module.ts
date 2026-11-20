import { Module } from '@nestjs/common';

import { NodeFileLockAdapter } from './adapters/node-file-lock.adapter.js';
import { NodeLockedFilesAdapter } from './adapters/node-locked-files.adapter.js';
import { IFileLockPort } from './ports/file-lock.port.js';
import { ILockedFilesPort } from './ports/locked-files.port.js';


@Module({
  providers: [
    { provide: IFileLockPort, useClass: NodeFileLockAdapter },
    { provide: ILockedFilesPort, useClass: NodeLockedFilesAdapter },
  ],
  exports: [IFileLockPort, ILockedFilesPort],
})
export class StorageModule {}
