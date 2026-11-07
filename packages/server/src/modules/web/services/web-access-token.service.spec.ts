import { Logger } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { WebAccessTokenService } from './web-access-token.service.js';


describe('WebAccessTokenService', () => {
  let dataDir: string;
  const tokenFile = () => join(dataDir, 'web', 'access-token');

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'web-token-'));
    vi.stubEnv('WEB_ACCESS_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('prefers WEB_ACCESS_TOKEN over the stored file', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', ' from-env ');
    const service = new WebAccessTokenService(dataDirectoryAt(dataDir));

    expect(service.verify('from-env')).toBe(true);
    expect(() => readFileSync(tokenFile())).toThrow();
  });

  it('generates a token file with mode 0600 on first use and reuses it', () => {
    const first = new WebAccessTokenService(dataDirectoryAt(dataDir));
    const generated = ((): string => {
      first.verify('x');
      return readFileSync(tokenFile(), 'utf8');
    })();

    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(statSync(tokenFile()).mode & 0o777).toBe(0o600);
    expect(new WebAccessTokenService(dataDirectoryAt(dataDir)).verify(generated)).toBe(true);
  });

  it('regenerates when the stored file is empty', () => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(tokenFile(), '\n');

    new WebAccessTokenService(dataDirectoryAt(dataDir)).verify('x');

    expect(readFileSync(tokenFile(), 'utf8')).toHaveLength(32);
  });

  it('verifies true for the token, false for a wrong one and false on length mismatch', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const service = new WebAccessTokenService(dataDirectoryAt(dataDir));

    expect(service.verify('secret')).toBe(true);
    expect(service.verify('secreT')).toBe(false);
    expect(service.verify('secret-longer')).toBe(false);
    expect(service.verify('')).toBe(false);
  });

  it('logs the token on bootstrap', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    new WebAccessTokenService(dataDirectoryAt(dataDir)).onApplicationBootstrap();

    expect(log).toHaveBeenCalledWith('Web interface access token: secret');
  });
});
