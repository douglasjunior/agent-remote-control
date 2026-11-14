import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { resolveFromRepositoryRoot } from './repository-root.util.js';


describe('resolveFromRepositoryRoot', () => {
  it('should point at the repository root, where the workspaces file lives', () => {
    expect(existsSync(resolveFromRepositoryRoot('pnpm-workspace.yaml'))).toBe(true);
  });

  it('should join relative segments under the root', () => {
    expect(resolveFromRepositoryRoot('data', 'web')).toBe(join(resolveFromRepositoryRoot('data'), 'web'));
  });

  it('should keep an absolute path untouched', () => {
    const absolute = join(resolveFromRepositoryRoot('x'), 'y');
    expect(isAbsolute(resolveFromRepositoryRoot(absolute))).toBe(true);
    expect(resolveFromRepositoryRoot(absolute)).toBe(absolute);
  });
});
