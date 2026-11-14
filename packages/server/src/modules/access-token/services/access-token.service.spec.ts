import { Logger } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { AccessTokenService } from './access-token.service.js';


describe('AccessTokenService', () => {
  let dataDir: string;
  const tokenFile = () => join(dataDir, 'web', 'access-token');
  const createService = () => new AccessTokenService(dataDirectoryAt(dataDir));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'web-token-'));
    vi.stubEnv('WEB_ACCESS_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should prefer WEB_ACCESS_TOKEN over the stored file', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', ' from-env ');
    const service = createService();

    expect(service.verify('from-env')).toBe(true);
    expect(service.token()).toBe('from-env');
    expect(() => readFileSync(tokenFile())).toThrow();
  });

  it('should generate a token file with mode 0600 on first use and reuse it', () => {
    const first = createService();
    const generated = ((): string => {
      first.verify('x');
      return readFileSync(tokenFile(), 'utf8');
    })();

    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(statSync(tokenFile()).mode & 0o777).toBe(0o600);
    expect(createService().verify(generated)).toBe(true);
  });

  it('should regenerate when the stored file is empty', () => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(tokenFile(), '\n');

    createService().verify('x');

    expect(readFileSync(tokenFile(), 'utf8')).toHaveLength(32);
  });

  it('should verify true for the token, false for a wrong one and false on length mismatch', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const service = createService();

    expect(service.verify('secret')).toBe(true);
    expect(service.verify('secreT')).toBe(false);
    expect(service.verify('secret-longer')).toBe(false);
    expect(service.verify('')).toBe(false);
  });

  it('should log the token on bootstrap', () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    createService().onApplicationBootstrap();

    expect(log.mock.calls).toEqual([['Web interface access token: secret']]);
  });
});
