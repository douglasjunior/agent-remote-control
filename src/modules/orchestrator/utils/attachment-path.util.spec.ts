import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAttachmentPaths } from './attachment-path.util.js';


vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

const { statSync } = await import('node:fs');

const existingFiles = (...files: string[]) => {
  vi.mocked(statSync).mockImplementation((path) => {
    if (path === '/workspace/my-app') {
      return { isFile: () => false } as any;
    }
    if (!files.includes(path as string)) {
      throw new Error('ENOENT');
    }
    return { isFile: () => true } as any;
  });
};

describe('resolveAttachmentPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should keep absolute paths of existing files', () => {
    existingFiles('/app/shot.png', '/app/report.pdf');

    expect(resolveAttachmentPaths(['/app/shot.png', '/app/report.pdf'], '/workspace')).toEqual(['/app/shot.png', '/app/report.pdf']);
  });

  it('should resolve relative paths against the base directory', () => {
    existingFiles('/workspace/my-app/docs/report.pdf');

    expect(resolveAttachmentPaths(['my-app/docs/report.pdf'], '/workspace')).toEqual(['/workspace/my-app/docs/report.pdf']);
  });

  it('should accept a file:// prefix', () => {
    existingFiles('/app/shot.png');

    expect(resolveAttachmentPaths(['file:///app/shot.png'], '/workspace')).toEqual(['/app/shot.png']);
  });

  it('should decode a percent-encoded file URL', () => {
    existingFiles('/app/My Report.pdf');

    expect(resolveAttachmentPaths(['file:///app/My%20Report.pdf'], '/workspace')).toEqual(['/app/My Report.pdf']);
  });

  it('should strip the prefix of a file URL that names a host', () => {
    existingFiles('/workspace/app/shot.png');

    expect(resolveAttachmentPaths(['file://app/shot.png'], '/workspace')).toEqual(['/workspace/app/shot.png']);
  });

  it('should drop missing files and directories', () => {
    existingFiles('/app/shot.png');

    expect(resolveAttachmentPaths(['/app/missing.png', '/workspace/my-app', '/app/shot.png'], '/workspace')).toEqual(['/app/shot.png']);
  });

  it('should list a file only once', () => {
    existingFiles('/workspace/shot.png');

    expect(resolveAttachmentPaths(['/workspace/shot.png', 'shot.png'], '/workspace')).toEqual(['/workspace/shot.png']);
  });
});
