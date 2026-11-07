import type { ChildProcess } from 'node:child_process';

import type {
  IProcessRunnerPort,
  ProcessRunResult,
  ProcessSpawnOptions,
} from '../ports/process-runner.port.js';

import { FakeLoginProcess } from './fake-login-process.js';


export type RecordedSpawn = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ProcessSpawnOptions | undefined;
};

export class StubProcessRunner implements IProcessRunnerPort {
  readonly runs: { command: string; args: readonly string[]; signal?: AbortSignal }[] = [];
  readonly spawns: RecordedSpawn[] = [];
  readonly processes: FakeLoginProcess[] = [];
  runResult: (command: string, args: readonly string[]) => Promise<ProcessRunResult> =
    async () => ({ exitCode: 0, output: '' });

  spawnError: Error | null = null;

  async run(
    command: string,
    args: readonly string[],
    options?: Pick<ProcessSpawnOptions, 'signal' | 'cwd'>,
  ): Promise<ProcessRunResult> {
    this.runs.push({ command, args, signal: options?.signal });
    return this.runResult(command, args);
  }

  async runInteractive(): Promise<number> {
    return 0;
  }

  spawn(command: string, args: readonly string[], options?: ProcessSpawnOptions): ChildProcess {
    if (this.spawnError) {
      throw this.spawnError;
    }
    this.spawns.push({ command, args, options });
    const process = new FakeLoginProcess();
    this.processes.push(process);
    return process.asChildProcess();
  }

  reexec(): void {
    return undefined;
  }
}
