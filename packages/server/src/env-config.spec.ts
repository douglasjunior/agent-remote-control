import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvironment } from './env-config.js';


describe('loadEnvironment', () => {
  let directory: string;
  let envFile: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'env-config-'));
    envFile = join(directory, '.env');
    rs.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('should keep a variable set in the environment, even to an empty text, over the file', async () => {
    writeFileSync(envFile, 'ARC_TEST_EMPTY=from-file\nARC_TEST_SET=from-file\n');
    rs.stubEnv('ARC_TEST_EMPTY', '');
    rs.stubEnv('ARC_TEST_SET', 'from-env');

    await loadEnvironment(envFile);

    expect(process.env.ARC_TEST_EMPTY).toBe('');
    expect(process.env.ARC_TEST_SET).toBe('from-env');
  });

  it('should take from the file a variable the environment leaves unset, expanding references', async () => {
    writeFileSync(envFile, 'ARC_TEST_HOST=arc.example.com\nARC_TEST_URL=https://${ARC_TEST_HOST}/\n');
    rs.stubEnv('ARC_TEST_HOST', undefined);
    rs.stubEnv('ARC_TEST_URL', undefined);

    await loadEnvironment(envFile);

    expect(process.env.ARC_TEST_HOST).toBe('arc.example.com');
    expect(process.env.ARC_TEST_URL).toBe('https://arc.example.com/');
  });

  it('should read no file under test', async () => {
    writeFileSync(envFile, 'ARC_TEST_IGNORED=from-file\n');
    rs.stubEnv('NODE_ENV', 'test');
    rs.stubEnv('ARC_TEST_IGNORED', undefined);

    await loadEnvironment(envFile);

    expect(process.env.ARC_TEST_IGNORED).toBeUndefined();
  });
});
