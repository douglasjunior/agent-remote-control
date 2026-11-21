import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


/**
 * Points `DATA_DIR` at a new temporary directory for each test of the calling `describe` and removes it afterwards.
 * A spec that compiles a module importing the database module needs it, since compiling opens `DATA_DIR/arc.sqlite`.
 */
export function useTemporaryDataDir(): void {
  let dataDir = '';
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'arc-data-'));
    rs.stubEnv('DATA_DIR', dataDir);
  });
  afterEach(() => {
    rs.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });
}
