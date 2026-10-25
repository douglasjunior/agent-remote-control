import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';


/** Resolves the attachment paths the CEO wrote, keeping only the regular files that exist, without duplicates. */
export function resolveAttachmentPaths(paths: readonly string[], baseDir: string): string[] {
  const resolved = new Set<string>();
  for (const rawPath of paths) {
    const path = rawPath.trim().replace(/^file:\/\//, '');
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
