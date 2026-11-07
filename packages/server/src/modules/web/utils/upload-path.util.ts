import { posix } from 'node:path';


const UPLOADS_ROOT = '.arc-uploads';

/** Where the files uploaded to a conversation live, relative to the workspace base directory. */
export function uploadDirectory(conversationId: string): string {
  return `${UPLOADS_ROOT}/${conversationId}`;
}

/** Whether `path` points inside the upload directory of `conversationId`, with no way to climb out of it. */
export function isUploadPathOf(conversationId: string, path: string): boolean {
  const normalized = posix.normalize(path);
  return normalized === path && normalized.startsWith(`${uploadDirectory(conversationId)}/`);
}
