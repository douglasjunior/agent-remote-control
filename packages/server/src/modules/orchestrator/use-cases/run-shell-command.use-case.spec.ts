import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  IProcessRunnerPort,
  ProcessRunResult,
  ProcessSpawnOptions,
} from '../../agent/ports/process-runner.port.js';
import type { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { ShellCommandDisabledError } from '../models/shell-command-disabled.error.js';
import { ShellCommandConfigService } from '../services/shell-command-config.service.js';

import { RunShellCommandUseCase } from './run-shell-command.use-case.js';


type RunCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: Pick<ProcessSpawnOptions, 'signal' | 'cwd'>;
};

function buildRunner(handler: (call: RunCall) => Promise<ProcessRunResult>) {
  const calls: RunCall[] = [];
  const runner = {
    run: (command: string, args: readonly string[], options?: Pick<ProcessSpawnOptions, 'signal' | 'cwd'>) => {
      const call = { command, args, options };
      calls.push(call);
      return handler(call);
    },
  } as unknown as IProcessRunnerPort;
  return { runner, calls };
}

const workspace = { getBaseDirectory: () => '/workspaces' } as unknown as IWorkspacePort;

describe('RunShellCommandUseCase', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SHELL_COMMAND_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should reject when shell commands are disabled', async () => {
    delete process.env.SHELL_COMMAND_ENABLED;
    const { runner, calls } = buildRunner(async () => ({ exitCode: 0, output: '' }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    expect(useCase.isEnabled()).toBe(false);
    await expect(useCase.execute('conv-1', 'ls')).rejects.toBeInstanceOf(ShellCommandDisabledError);
    expect(calls).toHaveLength(0);
  });

  it('should run the command through sh in the workspace directory', async () => {
    const { runner, calls } = buildRunner(async () => ({ exitCode: 0, output: 'ok' }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    const result = await useCase.execute('conv-1', 'df -h');

    expect(useCase.isEnabled()).toBe(true);
    expect(calls[0]).toMatchObject({ command: 'sh', args: ['-c', 'df -h'], options: { cwd: '/workspaces' } });
    expect(result).toEqual({
      command: 'df -h',
      exitCode: 0,
      output: 'ok',
      truncated: false,
      timedOut: false,
      cancelled: false,
    });
  });

  it('should report a non-zero exit code', async () => {
    const { runner } = buildRunner(async () => ({ exitCode: 3, output: 'boom' }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    await expect(useCase.execute('conv-1', 'exit 3')).resolves.toMatchObject({ exitCode: 3 });
  });

  it('should keep only the end of an oversized output', async () => {
    process.env.SHELL_COMMAND_MAX_OUTPUT_CHARS = '5';
    const { runner } = buildRunner(async () => ({ exitCode: 0, output: '0123456789' }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    await expect(useCase.execute('conv-1', 'seq')).resolves.toMatchObject({
      output: '56789',
      truncated: true,
    });
  });

  it('should flag a command aborted by the timeout', async () => {
    process.env.SHELL_COMMAND_TIMEOUT_MS = '10';
    const { runner } = buildRunner(call => new Promise((resolve) => {
      call.options?.signal?.addEventListener('abort', () => resolve({ exitCode: 1, output: '' }));
    }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    await expect(useCase.execute('conv-1', 'sleep 100')).resolves.toMatchObject({
      timedOut: true,
      cancelled: false,
    });
  });

  it('should cancel a running command and forget it afterwards', async () => {
    const { runner } = buildRunner(call => new Promise((resolve) => {
      call.options?.signal?.addEventListener('abort', () => resolve({ exitCode: 1, output: '' }));
    }));
    const useCase = new RunShellCommandUseCase(runner, workspace, new ShellCommandConfigService());

    const running = useCase.execute('conv-1', 'sleep 100');

    expect(useCase.cancel('conv-1')).toBe(true);
    await expect(running).resolves.toMatchObject({ cancelled: true, timedOut: false });
    expect(useCase.cancel('conv-1')).toBe(false);
  });
});
