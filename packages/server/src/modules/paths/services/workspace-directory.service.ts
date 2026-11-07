import { Injectable } from '@nestjs/common';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';


@Injectable()
export class WorkspaceDirectoryService {
  /** `WORKSPACE_DIR`, or `workspaces/` at the repository root; a relative `WORKSPACE_DIR` starts from the repository root. */
  resolve(): string {
    return resolveFromRepositoryRoot(process.env.WORKSPACE_DIR?.trim() || 'workspaces');
  }
}
