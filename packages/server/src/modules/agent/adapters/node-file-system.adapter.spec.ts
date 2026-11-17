import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { NodeFileSystemAdapter } from './node-file-system.adapter.js';


function enoent(): NodeJS.ErrnoException {
  const error = new Error(
    'ENOENT: no such file or directory',
  ) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

rs.mock('node:fs', () => ({
  accessSync: rs.fn(),
  constants: { R_OK: 4 },
  existsSync: rs.fn(),
  readdirSync: rs.fn(),
  statSync: rs.fn(),
  watch: rs.fn(),
}));

rs.mock('node:fs/promises', () => ({
  chmod: rs.fn(),
  mkdir: rs.fn(),
  readFile: rs.fn(),
  writeFile: rs.fn(),
  rm: rs.fn(),
}));

rs.mock('node:os', () => ({
  homedir: rs.fn(() => '/home/user'),
}));

const { accessSync, existsSync, readdirSync, statSync, watch } =
  await import('node:fs');
const { chmod, mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
const { homedir } = await import('node:os');

describe('NodeFileSystemAdapter', () => {
  let debugSpy: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    debugSpy = rs.spyOn(Logger.prototype, 'debug').mockImplementation(rs.fn());
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  describe('isInPath', () => {
    const originalPath = process.env.PATH;

    beforeEach(() => {
      rs.mocked(existsSync).mockReset();
      process.env.PATH = '/usr/local/bin:/usr/bin';
    });

    afterEach(() => {
      process.env.PATH = originalPath;
    });

    it('should return true when the binary exists in any PATH directory', () => {
      rs.mocked(existsSync).mockImplementation(
        path => path === '/usr/local/bin/agy',
      );

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isInPath('agy')).toBe(true);
    });

    it('should return false when the binary is not found in any PATH directory', () => {
      rs.mocked(existsSync).mockReturnValue(false);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isInPath('inexistent-binary')).toBe(false);
    });

    it('should ignore empty PATH segments', () => {
      process.env.PATH = ':/usr/local/bin::';
      rs.mocked(existsSync).mockImplementation(
        path => path === '/usr/local/bin/agy',
      );

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isInPath('agy')).toBe(true);
    });

    it('should fall back to an empty PATH when the env var is missing', () => {
      delete process.env.PATH;
      rs.mocked(existsSync).mockReturnValue(false);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isInPath('agy')).toBe(false);
      expect(existsSync).not.toHaveBeenCalled();
    });

    it('should probe each PATHEXT extension when running on Windows', () => {
      const originalPlatform = process.platform;
      const originalPathExt = process.env.PATHEXT;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      process.env.PATH = '/win-bin';
      process.env.PATHEXT = '.EXE;.CMD';
      rs.mocked(existsSync).mockImplementation(
        path => path === '/win-bin/agy.CMD',
      );

      try {
        const adapter = new NodeFileSystemAdapter();
        expect(adapter.isInPath('agy')).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
        process.env.PATHEXT = originalPathExt;
      }
    });

    it('should fall back to the default PATHEXT list when the env var is missing on Windows', () => {
      const originalPlatform = process.platform;
      const originalPathExt = process.env.PATHEXT;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      process.env.PATH = '/win-bin';
      delete process.env.PATHEXT;
      rs.mocked(existsSync).mockImplementation(
        path => path === '/win-bin/agy.COM',
      );

      try {
        const adapter = new NodeFileSystemAdapter();
        expect(adapter.isInPath('agy')).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
        if (originalPathExt !== undefined)
          process.env.PATHEXT = originalPathExt;
      }
    });
  });

  describe('resolveInPath', () => {
    const originalPath = process.env.PATH;

    beforeEach(() => {
      rs.mocked(existsSync).mockReset();
      process.env.PATH = '/usr/local/bin:/usr/bin';
    });

    afterEach(() => {
      process.env.PATH = originalPath;
    });

    it('should return the absolute path of the first PATH directory that contains the binary', () => {
      rs.mocked(existsSync).mockImplementation(
        path => path === '/usr/bin/agy',
      );

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.resolveInPath('agy')).toBe('/usr/bin/agy');
    });

    it('should return null when the binary is not found in any PATH directory', () => {
      rs.mocked(existsSync).mockReturnValue(false);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.resolveInPath('inexistent-binary')).toBeNull();
    });

    it('should resolve the path with the matching PATHEXT extension on Windows', () => {
      const originalPlatform = process.platform;
      const originalPathExt = process.env.PATHEXT;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      process.env.PATH = '/win-bin';
      process.env.PATHEXT = '.EXE;.CMD';
      rs.mocked(existsSync).mockImplementation(
        path => path === '/win-bin/agy.CMD',
      );

      try {
        const adapter = new NodeFileSystemAdapter();
        expect(adapter.resolveInPath('agy')).toBe('/win-bin/agy.CMD');
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
        process.env.PATHEXT = originalPathExt;
      }
    });
  });

  describe('isReadableDirectory', () => {
    it('should return true when the path is readable and is a directory', () => {
      rs.mocked(accessSync).mockReturnValueOnce(undefined);
      rs.mocked(statSync).mockReturnValueOnce({
        isDirectory: () => true,
      } as ReturnType<typeof statSync>);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableDirectory('/repo')).toBe(true);
    });

    it('should return false without logging when the path does not exist (ENOENT)', () => {
      rs.mocked(accessSync).mockImplementationOnce(() => {
        throw enoent();
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableDirectory('/missing')).toBe(false);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return false and log when accessSync throws a non-ENOENT error', () => {
      rs.mocked(accessSync).mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableDirectory('/forbidden')).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(
        'is_readable_directory_failed: /forbidden',
      );
    });

    it('should return false when the path exists but is not a directory', () => {
      rs.mocked(accessSync).mockReturnValueOnce(undefined);
      rs.mocked(statSync).mockReturnValueOnce({
        isDirectory: () => false,
      } as ReturnType<typeof statSync>);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableDirectory('/file.txt')).toBe(false);
    });

    it('should return false and log when statSync throws after accessSync succeeds', () => {
      rs.mocked(accessSync).mockReturnValueOnce(undefined);
      rs.mocked(statSync).mockImplementationOnce(() => {
        throw new Error('stat failed');
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableDirectory('/race')).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(
        'is_readable_directory_failed: /race',
      );
    });
  });

  describe('isReadableFile', () => {
    it('should return true when the path is readable and is a file', () => {
      rs.mocked(accessSync).mockReturnValueOnce(undefined);
      rs.mocked(statSync).mockReturnValueOnce({
        isFile: () => true,
      } as ReturnType<typeof statSync>);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableFile('/repo/file.txt')).toBe(true);
    });

    it('should return false when the path exists but is not a file', () => {
      rs.mocked(accessSync).mockReturnValueOnce(undefined);
      rs.mocked(statSync).mockReturnValueOnce({
        isFile: () => false,
      } as ReturnType<typeof statSync>);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableFile('/repo/dir')).toBe(false);
    });

    it('should return false without logging when the path does not exist (ENOENT)', () => {
      rs.mocked(accessSync).mockImplementationOnce(() => {
        throw enoent();
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableFile('/missing.txt')).toBe(false);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return false and log when accessSync throws a non-ENOENT error', () => {
      rs.mocked(accessSync).mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.isReadableFile('/forbidden.txt')).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(
        'is_readable_file_failed: /forbidden.txt',
      );
    });
  });

  describe('readDirectoryNames', () => {
    it('should return the directory entry names', () => {
      rs.mocked(readdirSync).mockReturnValueOnce([
        '001-test',
        '002-test',
      ] as unknown as ReturnType<typeof readdirSync>);

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.readDirectoryNames('/repo/specs')).toEqual([
        '001-test',
        '002-test',
      ]);
      expect(readdirSync).toHaveBeenCalledWith('/repo/specs');
    });

    it('should return an empty array without logging when the path does not exist (ENOENT)', () => {
      rs.mocked(readdirSync).mockImplementationOnce(() => {
        throw enoent();
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.readDirectoryNames('/missing')).toEqual([]);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return an empty array and log when readdirSync throws a non-ENOENT error', () => {
      rs.mocked(readdirSync).mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const adapter = new NodeFileSystemAdapter();

      expect(adapter.readDirectoryNames('/forbidden')).toEqual([]);
      expect(debugSpy).toHaveBeenCalledWith(
        'read_directory_names_failed: /forbidden',
      );
    });
  });

  describe('readJson', () => {
    it('should parse and return the JSON content of the file', async () => {
      rs.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify({ hello: 'world' }),
      );

      const adapter = new NodeFileSystemAdapter();
      const result = await adapter.readJson<{ hello: string }>(
        '/path/to/file.json',
      );

      expect(result).toEqual({ hello: 'world' });
      expect(readFile).toHaveBeenCalledWith('/path/to/file.json', 'utf-8');
    });

    it('should return null without logging when the file does not exist (ENOENT)', async () => {
      rs.mocked(readFile).mockRejectedValueOnce(enoent());

      const adapter = new NodeFileSystemAdapter();

      expect(await adapter.readJson('/missing.json')).toBeNull();
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return null and log when the file contains invalid JSON', async () => {
      rs.mocked(readFile).mockResolvedValueOnce('{not json');

      const adapter = new NodeFileSystemAdapter();

      expect(await adapter.readJson('/broken.json')).toBeNull();
      expect(debugSpy).toHaveBeenCalledWith('read_json_failed: /broken.json');
    });
  });

  describe('writeJson', () => {
    it('should ensure the parent directory exists before writing', async () => {
      rs.mocked(mkdir).mockResolvedValueOnce(undefined);
      rs.mocked(writeFile).mockResolvedValueOnce(undefined);

      const adapter = new NodeFileSystemAdapter();
      await adapter.writeJson('/repo/state.json', { agent: 'agy' });

      expect(mkdir).toHaveBeenCalledWith('/repo', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        '/repo/state.json',
        JSON.stringify({ agent: 'agy' }, null, 2),
      );
    });

    it('should apply restrictive file and directory modes when provided', async () => {
      rs.mocked(mkdir).mockResolvedValueOnce(undefined);
      rs.mocked(writeFile).mockResolvedValueOnce(undefined);

      const adapter = new NodeFileSystemAdapter();
      await adapter.writeJson(
        '/home/user/.config/agent/user-state.json',
        { token: 'secret' },
        { mode: 0o600, dirMode: 0o700 },
      );

      expect(mkdir).toHaveBeenCalledWith('/home/user/.config/agent', {
        recursive: true,
        mode: 0o700,
      });
      expect(writeFile).toHaveBeenCalledWith(
        '/home/user/.config/agent/user-state.json',
        JSON.stringify({ token: 'secret' }, null, 2),
        { mode: 0o600 },
      );
    });
  });

  describe('readText', () => {
    it('should return the raw text content of the file', async () => {
      rs.mocked(readFile).mockResolvedValueOnce('# Content\n');

      const adapter = new NodeFileSystemAdapter();
      const result = await adapter.readText('/repo/file.md');

      expect(result).toBe('# Content\n');
      expect(readFile).toHaveBeenCalledWith('/repo/file.md', 'utf-8');
    });

    it('should return null without logging when the file does not exist (ENOENT)', async () => {
      rs.mocked(readFile).mockRejectedValueOnce(enoent());

      const adapter = new NodeFileSystemAdapter();

      expect(await adapter.readText('/missing.md')).toBeNull();
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('should return null and log when readFile throws a non-ENOENT error', async () => {
      rs.mocked(readFile).mockRejectedValueOnce(new Error('EACCES'));

      const adapter = new NodeFileSystemAdapter();

      expect(await adapter.readText('/forbidden.md')).toBeNull();
      expect(debugSpy).toHaveBeenCalledWith('read_text_failed: /forbidden.md');
    });
  });

  describe('writeText', () => {
    it('should ensure the parent directory exists before writing', async () => {
      rs.mocked(mkdir).mockResolvedValueOnce(undefined);
      rs.mocked(writeFile).mockResolvedValueOnce(undefined);

      const adapter = new NodeFileSystemAdapter();
      await adapter.writeText('/repo/file.md', '# Content\n');

      expect(mkdir).toHaveBeenCalledWith('/repo', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith('/repo/file.md', '# Content\n');
    });
  });

  describe('writeExecutable', () => {
    it('should write the file and mark it executable', async () => {
      rs.mocked(mkdir).mockResolvedValueOnce(undefined);
      rs.mocked(writeFile).mockResolvedValueOnce(undefined);
      rs.mocked(chmod).mockResolvedValueOnce(undefined);

      await new NodeFileSystemAdapter().writeExecutable('/tmp/openers/xdg-open', '#!/bin/sh\nexit 0\n');

      expect(writeFile).toHaveBeenCalledWith('/tmp/openers/xdg-open', '#!/bin/sh\nexit 0\n');
      expect(chmod).toHaveBeenCalledWith('/tmp/openers/xdg-open', 0o755);
    });
  });

  describe('deleteFile', () => {
    it('should remove the file forcing a no-op when it does not exist', async () => {
      rs.mocked(rm).mockResolvedValueOnce(undefined);

      const adapter = new NodeFileSystemAdapter();
      await adapter.deleteFile('/repo/state.json');

      expect(rm).toHaveBeenCalledWith('/repo/state.json', { force: true });
    });
  });

  describe('joinPath', () => {
    it('should join segments using the platform separator', () => {
      const adapter = new NodeFileSystemAdapter();

      expect(adapter.joinPath('a', 'b', 'c')).toBe('a/b/c');
    });
  });

  describe('resolvePath', () => {
    it('should normalize relative segments into an absolute path', () => {
      const adapter = new NodeFileSystemAdapter();

      expect(adapter.resolvePath('/repo/sub/..')).toBe('/repo');
    });

    it('should resolve a relative path against the current working directory', () => {
      const adapter = new NodeFileSystemAdapter();

      expect(adapter.resolvePath('.')).toBe(process.cwd());
    });
  });

  describe('resolveUserConfigDir', () => {
    beforeEach(() => {
      rs.mocked(homedir).mockReturnValue('/home/user');
    });

    it('should always resolve to <home>/.config/<appName>', () => {
      const adapter = new NodeFileSystemAdapter();

      expect(adapter.resolveUserConfigDir('agent-remote-control')).toBe(
        '/home/user/.config/agent-remote-control',
      );
    });
  });

  describe('watchDirectory', () => {
    function fakeWatcher() {
      return { on: rs.fn(), close: rs.fn() };
    }

    it('should watch the directory and forward entry changes to the callback', () => {
      const watcher = fakeWatcher();
      rs.mocked(watch).mockReturnValueOnce(
        watcher as unknown as ReturnType<typeof watch>,
      );
      const onChange = rs.fn();

      const adapter = new NodeFileSystemAdapter();
      adapter.watchDirectory('/repo', onChange);

      expect(watch).toHaveBeenCalledWith(
        '/repo',
        { persistent: false },
        expect.any(Function),
      );

      const [, , listener] = rs.mocked(watch).mock.calls[0] as unknown as [
        string,
        unknown,
        (event: string, filename: string | Buffer | null) => void,
      ];

      listener('rename', 'file.txt');
      expect(onChange).toHaveBeenCalledWith('file.txt');

      listener('change', Buffer.from('file.txt'));
      expect(onChange).toHaveBeenCalledWith('file.txt');

      listener('rename', null);
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it('should return an unsubscribe that closes the watcher', () => {
      const watcher = fakeWatcher();
      rs.mocked(watch).mockReturnValueOnce(
        watcher as unknown as ReturnType<typeof watch>,
      );

      const adapter = new NodeFileSystemAdapter();
      const stop = adapter.watchDirectory('/repo', rs.fn());
      stop();

      expect(watcher.close).toHaveBeenCalledTimes(1);
    });

    it('should log watcher error events at debug level', () => {
      const watcher = fakeWatcher();
      rs.mocked(watch).mockReturnValueOnce(
        watcher as unknown as ReturnType<typeof watch>,
      );

      const adapter = new NodeFileSystemAdapter();
      adapter.watchDirectory('/repo', rs.fn());

      const errorHandler = watcher.on.mock.calls.find(
        ([event]) => event === 'error',
      )?.[1] as (error: Error) => void;
      errorHandler(new Error('boom'));

      expect(debugSpy).toHaveBeenCalledWith('watch_directory_failed: /repo');
    });

    it('should log and return a no-op when watch throws a non-ENOENT error', () => {
      rs.mocked(watch).mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const adapter = new NodeFileSystemAdapter();
      const stop = adapter.watchDirectory('/forbidden', rs.fn());

      expect(debugSpy).toHaveBeenCalledWith(
        'watch_directory_failed: /forbidden',
      );
      expect(() => stop()).not.toThrow();
    });

    it('should return a no-op without logging when watch throws ENOENT', () => {
      rs.mocked(watch).mockImplementationOnce(() => {
        throw enoent();
      });

      const adapter = new NodeFileSystemAdapter();
      const stop = adapter.watchDirectory('/missing', rs.fn());

      expect(debugSpy).not.toHaveBeenCalled();
      expect(() => stop()).not.toThrow();
    });
  });
});
