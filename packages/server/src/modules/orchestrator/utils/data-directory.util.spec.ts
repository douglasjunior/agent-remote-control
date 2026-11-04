import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveFromRepositoryRoot } from '../../../repository-root.util.js';

import { resolveDataDirectory } from './data-directory.util.js';


describe('resolveDataDirectory', () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
  });

  it('should prefer the custom directory', () => {
    process.env.DATA_DIR = '/from/env';

    expect(resolveDataDirectory('/custom/dir')).toBe(resolve('/custom/dir'));
  });

  it('should use the trimmed DATA_DIR environment variable', () => {
    process.env.DATA_DIR = '  /from/env  ';

    expect(resolveDataDirectory()).toBe(resolve('/from/env'));
  });

  it('should resolve a relative DATA_DIR from the repository root', () => {
    process.env.DATA_DIR = './custom-data';

    expect(resolveDataDirectory()).toBe(resolveFromRepositoryRoot('custom-data'));
  });

  it('should fall back to the data folder at the repository root', () => {
    process.env.DATA_DIR = '   ';

    expect(resolveDataDirectory()).toBe(resolveFromRepositoryRoot('data'));
  });
});
