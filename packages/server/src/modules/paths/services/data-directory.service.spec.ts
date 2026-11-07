import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';

import { DataDirectoryService } from './data-directory.service.js';


describe('DataDirectoryService', () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
  });

  it('should use the trimmed DATA_DIR environment variable', () => {
    process.env.DATA_DIR = '  /from/env  ';

    expect(new DataDirectoryService().resolve()).toBe(resolve('/from/env'));
  });

  it('should resolve a relative DATA_DIR from the repository root', () => {
    process.env.DATA_DIR = './custom-data';

    expect(new DataDirectoryService().resolve()).toBe(resolveFromRepositoryRoot('custom-data'));
  });

  it.each([['blank', '   '], ['unset', undefined]])('should fall back to the data folder at the repository root when DATA_DIR is %s', (_case, value) => {
    if (value === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = value;
    }

    expect(new DataDirectoryService().resolve()).toBe(resolveFromRepositoryRoot('data'));
  });
});
