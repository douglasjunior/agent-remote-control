import type { ChildProcess, StdioOptions } from 'node:child_process';


export type ProcessRunResult = {
  readonly exitCode: number;
  readonly output: string;
};

export type ProcessSpawnOptions = {
  readonly cwd?: string;
  readonly stdio?: StdioOptions;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
};

export interface IProcessRunnerPort {
  run(command: string, args: readonly string[]): Promise<ProcessRunResult>;
  runInteractive(command: string, args: readonly string[]): Promise<number>;
  spawn(
    command: string,
    args: readonly string[],
    options?: ProcessSpawnOptions,
  ): ChildProcess;
  reexec(): void;
}

export const IProcessRunnerPort = Symbol('IProcessRunnerPort');
