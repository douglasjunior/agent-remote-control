import { Injectable } from '@nestjs/common';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';


@Injectable()
export class DataDirectoryService {
  /** `DATA_DIR`, or `data/` at the repository root; a relative `DATA_DIR` starts from the repository root. */
  resolve(): string {
    return resolveFromRepositoryRoot(process.env.DATA_DIR?.trim() || 'data');
  }
}
