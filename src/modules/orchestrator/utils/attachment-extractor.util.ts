import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';


const ATTACHMENT_PATTERN = /!\[.*?\]\((?:file:\/\/)?([^)]+)\)|(?<!!)\[.*?\]\(file:\/\/([^)]+)\)/g;

export function extractAttachments(text: string, baseDir?: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const attachments: string[] = [];
  const seen = new Set<string>();

  const matches = text.matchAll(ATTACHMENT_PATTERN);
  for (const match of matches) {
    const rawTarget = (match[1] ?? match[2])?.trim();
    if (!rawTarget) {
      continue;
    }

    if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://') || rawTarget.startsWith('data:')) {
      continue;
    }

    const withoutScheme = rawTarget.replace(/^file:\/\//, '');
    let decodedTarget: string;
    try {
      decodedTarget = decodeURIComponent(withoutScheme);
    } catch {
      decodedTarget = withoutScheme;
    }

    const resolvedPath = !isAbsolute(decodedTarget) && baseDir
      ? resolve(baseDir, decodedTarget)
      : decodedTarget;

    try {
      if (existsSync(resolvedPath)) {
        if (!seen.has(resolvedPath)) {
          seen.add(resolvedPath);
          attachments.push(resolvedPath);
        }
      }
    } catch {
      // Ignored to prevent filesystem access errors from halting extraction
    }
  }

  return attachments;
}
