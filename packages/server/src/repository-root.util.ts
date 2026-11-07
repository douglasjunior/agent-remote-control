import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


/** `.env`, `data/` and `workspaces/` live at the repository root, whatever directory a script runs from. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function resolveFromRepositoryRoot(...segments: string[]): string {
  return resolve(REPOSITORY_ROOT, ...segments);
}
