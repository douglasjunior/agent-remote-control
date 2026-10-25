import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const FILE_URL_PREFIX = 'file://';

/** Resolves the attachment paths the CEO wrote, keeping only the regular files that exist, without duplicates. */
export function resolveAttachmentPaths(paths: readonly string[], baseDir: string): string[] {
  const resolved = new Set<string>();
  for (const rawPath of paths) {
    const path = toFilePath(rawPath.trim());
    const absolutePath = isAbsolute(path) ? path : resolve(baseDir, path);
    try {
      if (statSync(absolutePath).isFile()) {
        resolved.add(absolutePath);
      }
    } catch {
      continue;
    }
  }
  return [...resolved];
}

/** A file URL percent-encodes characters such as spaces, which the file name on disk does not have. */
function toFilePath(path: string): string {
  if (!path.startsWith(FILE_URL_PREFIX)) {
    return path;
  }
  try {
    return fileURLToPath(path);
  } catch {
    return path.slice(FILE_URL_PREFIX.length);
  }
}
