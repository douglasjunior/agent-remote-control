import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractAttachments } from './attachment-extractor.util.js';


vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

const { statSync } = await import('node:fs');

const mockFile = (predicate: (path: string) => boolean) => {
  vi.mocked(statSync).mockImplementation((path) => {
    if (predicate(path as string)) {
      return { isFile: () => true } as any;
    }
    return { isFile: () => false } as any;
  });
};

describe('extractAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array for empty, null, undefined or non-string input', () => {
    expect(extractAttachments('')).toEqual([]);
    expect(extractAttachments(null as unknown as string)).toEqual([]);
    expect(extractAttachments(undefined as unknown as string)).toEqual([]);
    expect(extractAttachments(123 as unknown as string)).toEqual([]);
  });

  it('should return empty array when no markdown links or images exist', () => {
    expect(extractAttachments('Just plain text without links.')).toEqual([]);
  });

  it('should extract absolute path image when file exists on disk', () => {
    mockFile(path => path === '/app/images/shot.png');

    const result = extractAttachments('See image: ![screenshot](/app/images/shot.png)');
    expect(result).toEqual(['/app/images/shot.png']);
    expect(statSync).toHaveBeenCalledWith('/app/images/shot.png');
  });

  it('should extract image with file:// prefix when file exists on disk', () => {
    mockFile(path => path === '/app/images/diagram.png');

    const result = extractAttachments('Check diagram: ![diagram](file:///app/images/diagram.png)');
    expect(result).toEqual(['/app/images/diagram.png']);
    expect(statSync).toHaveBeenCalledWith('/app/images/diagram.png');
  });

  it('should extract file:// link when file exists on disk', () => {
    mockFile(path => path === '/app/docs/report.pdf');

    const result = extractAttachments('Download [Report](file:///app/docs/report.pdf)');
    expect(result).toEqual(['/app/docs/report.pdf']);
    expect(statSync).toHaveBeenCalledWith('/app/docs/report.pdf');
  });

  it('should ignore directories that exist on disk', () => {
    vi.mocked(statSync).mockImplementation(path => ({
      isFile: () => path !== '/workspace/repositories/klist-website',
    } as any));

    const result = extractAttachments('Folder: [klist-website](file:///workspace/repositories/klist-website)');
    expect(result).toEqual([]);
    expect(statSync).toHaveBeenCalledWith('/workspace/repositories/klist-website');
  });

  it('should resolve relative path with baseDir when provided', () => {
    mockFile(path => path === '/workspace/project/assets/logo.png');

    const result = extractAttachments('Logo: ![logo](assets/logo.png)', '/workspace/project');
    expect(result).toEqual(['/workspace/project/assets/logo.png']);
    expect(statSync).toHaveBeenCalledWith('/workspace/project/assets/logo.png');
  });

  it('should keep relative path when baseDir is not provided', () => {
    mockFile(path => path === 'assets/logo.png');

    const result = extractAttachments('Logo: ![logo](assets/logo.png)');
    expect(result).toEqual(['assets/logo.png']);
    expect(statSync).toHaveBeenCalledWith('assets/logo.png');
  });

  it('should decode URI encoded characters in path', () => {
    mockFile(path => path === '/workspace/my document.pdf');

    const result = extractAttachments('File: [doc](file:///workspace/my%20document.pdf)');
    expect(result).toEqual(['/workspace/my document.pdf']);
  });

  it('should keep original path if decodeURIComponent throws', () => {
    mockFile(path => path === '/workspace/%E0%A4%A.png');

    const result = extractAttachments('File: ![bad-uri](/workspace/%E0%A4%A.png)');
    expect(result).toEqual(['/workspace/%E0%A4%A.png']);
  });

  it('should ignore remote web URLs for images', () => {
    const result = extractAttachments('![remote](https://example.com/image.png) and ![insecure](http://test.com/a.jpg) and ![data](data:image/png;base64,123)');
    expect(result).toEqual([]);
    expect(statSync).not.toHaveBeenCalled();
  });

  it('should ignore regular markdown links without file://', () => {
    const result = extractAttachments('Go to [Website](https://google.com) or [Local Guide](docs/guide.md)');
    expect(result).toEqual([]);
    expect(statSync).not.toHaveBeenCalled();
  });

  it('should filter out files that do not exist on disk', () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const result = extractAttachments('![missing](/path/missing.png)');
    expect(result).toEqual([]);
  });

  it('should deduplicate multiple occurrences of the same file preserving first occurrence order', () => {
    vi.mocked(statSync).mockReturnValue({ isFile: () => true } as any);

    const text = `
      First: ![one](/path/1.png)
      Second: [file two](file:///path/2.pdf)
      Third: ![one duplicate](/path/1.png)
      Fourth: [file two duplicate](file:///path/2.pdf)
      Fifth: ![three](/path/3.png)
    `;

    const result = extractAttachments(text);
    expect(result).toEqual(['/path/1.png', '/path/2.pdf', '/path/3.png']);
  });

  it('should ignore empty target paths in markdown syntax', () => {
    const result = extractAttachments('Empty: ![]() or ![](   )');
    expect(result).toEqual([]);
    expect(statSync).not.toHaveBeenCalled();
  });

  it('should safely catch and ignore errors thrown by statSync', () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = extractAttachments('![error](/path/forbidden.png)');
    expect(result).toEqual([]);
  });
});
