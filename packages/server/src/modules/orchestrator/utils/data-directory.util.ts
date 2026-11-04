import { resolve } from 'node:path';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';


export function resolveDataDirectory(custom?: string): string {
  if (custom) {
    return resolve(custom);
  }
  const fromEnv = process.env.DATA_DIR?.trim();
  if (fromEnv) {
    return resolveFromRepositoryRoot(fromEnv);
  }
  return resolveFromRepositoryRoot('data');
}
