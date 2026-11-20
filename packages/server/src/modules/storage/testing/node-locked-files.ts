import { NodeFileLockAdapter } from '../adapters/node-file-lock.adapter.js';
import { NodeLockedFilesAdapter } from '../adapters/node-locked-files.adapter.js';
import type { IFileLockPort } from '../ports/file-lock.port.js';
import type { ILockedFilesPort } from '../ports/locked-files.port.js';


/**
 * The locked files on the real disk, for the specs of the stores that persist through them. Each call stands for one
 * process: two results share no lock queue and contend through the lockfiles alone.
 */
export function createNodeLockedFiles(lock: IFileLockPort = new NodeFileLockAdapter()): ILockedFilesPort {
  return new NodeLockedFilesAdapter(lock);
}
