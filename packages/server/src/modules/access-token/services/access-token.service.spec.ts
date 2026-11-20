import { Logger } from '@nestjs/common';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';

import { AccessTokenService } from './access-token.service.js';


describe('AccessTokenService', () => {
  let dataDir: string;
  const tokenFile = () => join(dataDir, 'web', 'access-token');
  const createService = () => new AccessTokenService(dataDirectoryAt(dataDir), createNodeLockedFiles());
  const startService = async () => {
    const service = createService();
    await service.onModuleInit();
    return service;
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'web-token-'));
    rs.stubEnv('WEB_ACCESS_TOKEN', '');
  });

  afterEach(() => {
    rs.unstubAllEnvs();
    rs.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should prefer WEB_ACCESS_TOKEN over the stored file', async () => {
    rs.stubEnv('WEB_ACCESS_TOKEN', ' from-env ');
    const service = await startService();

    expect(service.verify('from-env')).toBe(true);
    expect(service.token()).toBe('from-env');
    expect(() => readFileSync(tokenFile())).toThrow();
  });

  it('should generate a token file with mode 0600 on start and reuse it', async () => {
    const generated = (await startService()).token();

    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readFileSync(tokenFile(), 'utf8')).toBe(generated);
    expect(statSync(tokenFile()).mode & 0o777).toBe(0o600);
    expect((await startService()).verify(generated)).toBe(true);
  });

  it('should give hosts that start together on one data directory the same token', async () => {
    const services = [createService(), createService(), createService()];

    await Promise.all(services.map(service => service.onModuleInit()));

    expect(new Set(services.map(service => service.token())).size).toBe(1);
    expect(readdirSync(join(dataDir, 'web'))).toEqual(['access-token']);
  });

  it('should regenerate when the stored file is empty', async () => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(tokenFile(), '\n');

    await startService();

    expect(readFileSync(tokenFile(), 'utf8')).toHaveLength(32);
  });

  it('should read a stored token without its surrounding whitespace', async () => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(tokenFile(), 'stored-token\n');

    expect((await startService()).token()).toBe('stored-token');
  });

  it('should refuse to give a token it has not read yet', () => {
    expect(() => createService().token()).toThrow('The access token is read when the module starts');
  });

  it('should verify true for the token, false for a wrong one and false on length mismatch', () => {
    rs.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const service = createService();

    expect(service.verify('secret')).toBe(true);
    expect(service.verify('secreT')).toBe(false);
    expect(service.verify('secret-longer')).toBe(false);
    expect(service.verify('')).toBe(false);
  });

  it('should log the token on bootstrap', () => {
    rs.stubEnv('WEB_ACCESS_TOKEN', 'secret');
    const log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    createService().onApplicationBootstrap();

    expect(log.mock.calls).toEqual([['Web interface access token: secret']]);
  });
});
