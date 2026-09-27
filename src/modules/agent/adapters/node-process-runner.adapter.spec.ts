import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeProcessRunnerAdapter } from './node-process-runner.adapter.js';


type ChildProcessLike = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
};

let spawnedProcs: ChildProcessLike[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as ChildProcessLike;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    spawnedProcs.push(proc);
    return proc;
  }),
}));

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);

describe('NodeProcessRunnerAdapter', () => {
  beforeEach(() => {
    spawnedProcs = [];
    spawnMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spawn', () => {
    it('should delegate to spawn passing through cwd, stdio, env and signal', () => {
      const adapter = new NodeProcessRunnerAdapter();
      const signal = AbortSignal.timeout(1000);
      const env = { CUSTOM: '1' } as NodeJS.ProcessEnv;

      adapter.spawn('agy', ['--version'], {
        cwd: '/test/cwd',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        signal,
      });

      expect(spawnMock).toHaveBeenCalledWith('agy', ['--version'], {
        cwd: '/test/cwd',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        signal,
      });
    });

    it('should tolerate omitted options', () => {
      const adapter = new NodeProcessRunnerAdapter();

      adapter.spawn('git', ['status']);

      expect(spawnMock).toHaveBeenCalledWith('git', ['status'], {
        cwd: undefined,
        stdio: undefined,
        env: undefined,
        signal: undefined,
      });
    });
  });

  describe('run', () => {
    it('should resolve with exitCode 0 and the combined output on success', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.run('npm', ['i']);

      const proc = spawnedProcs[0];
      proc.stdout.emit('data', Buffer.from('installed '));
      proc.stderr.emit('data', Buffer.from('warn: deprecated'));
      proc.emit('close', 0);

      await expect(promise).resolves.toEqual({
        exitCode: 0,
        output: 'installed warn: deprecated',
      });
      expect(spawnMock).toHaveBeenCalledWith('npm', ['i'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: undefined,
        signal: undefined,
      });
    });

    it('should resolve with a non-zero exitCode when the process fails', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.run('npm', ['i']);

      const proc = spawnedProcs[0];
      proc.stderr.emit('data', Buffer.from('EACCES'));
      proc.emit('close', 1);

      await expect(promise).resolves.toEqual({ exitCode: 1, output: 'EACCES' });
    });

    it('should resolve with exitCode 1 when spawn emits an error', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.run('npm', ['i']);

      const proc = spawnedProcs[0];
      proc.emit('error', new Error('spawn npm ENOENT'));

      await expect(promise).resolves.toEqual({
        exitCode: 1,
        output: 'spawn npm ENOENT',
      });
    });

    it('should default a null exit code to 0', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.run('npm', []);

      spawnedProcs[0].emit('close', null);

      await expect(promise).resolves.toEqual({ exitCode: 0, output: '' });
    });

    it('should fall back to String(error) when the error has no message', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.run('npm', ['i']);

      const proc = spawnedProcs[0];
      proc.stdout.emit('data', Buffer.from('prefix:'));
      proc.emit('error', new Error(''));

      await expect(promise).resolves.toEqual({
        exitCode: 1,
        output: 'prefix:Error',
      });
    });
  });

  describe('runInteractive', () => {
    it('should spawn with inherited stdio and resolve the exit code', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.runInteractive('node', ['script.js']);

      spawnedProcs[0].emit('close', 0);

      await expect(promise).resolves.toBe(0);
      expect(spawnMock).toHaveBeenCalledWith('node', ['script.js'], {
        stdio: 'inherit',
        env: undefined,
        signal: undefined,
      });
    });

    it('should resolve the non-zero close code', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.runInteractive('node', ['script.js']);

      spawnedProcs[0].emit('close', 7);

      await expect(promise).resolves.toBe(7);
    });

    it('should resolve 1 when spawn emits an error', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.runInteractive('node', ['script.js']);

      spawnedProcs[0].emit('error', new Error('spawn ENOENT'));

      await expect(promise).resolves.toBe(1);
    });

    it('should default a null close code to 0', async () => {
      const adapter = new NodeProcessRunnerAdapter();
      const promise = adapter.runInteractive('node', ['script.js']);

      spawnedProcs[0].emit('close', null);

      await expect(promise).resolves.toBe(0);
    });
  });

  describe('reexec', () => {
    it('should re-spawn the current process argv inheriting the terminal', () => {
      const adapter = new NodeProcessRunnerAdapter();

      adapter.reexec();

      expect(spawnMock).toHaveBeenCalledWith(
        process.argv[0],
        process.argv.slice(1),
        {
          stdio: 'inherit',
          env: undefined,
          signal: undefined,
        },
      );
    });

    it('should exit the current process with the child exit code', () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const adapter = new NodeProcessRunnerAdapter();

      adapter.reexec();
      spawnedProcs[0].emit('exit', 3);

      expect(exitSpy).toHaveBeenCalledWith(3);
    });

    it('should default a null child exit code to 0 when re-executing', () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const adapter = new NodeProcessRunnerAdapter();

      adapter.reexec();
      spawnedProcs[0].emit('exit', null);

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
