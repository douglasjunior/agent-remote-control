import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import type {
  IProcessRunnerPort,
  ProcessRunResult,
  ProcessSpawnOptions,
} from '../ports/process-runner.port.js';

@Injectable()
export class NodeProcessRunnerAdapter implements IProcessRunnerPort {
  spawn(
    command: string,
    args: readonly string[],
    options?: ProcessSpawnOptions,
  ): ChildProcess {
    return spawn(command, [...args], {
      stdio: options?.stdio,
      env: options?.env,
      signal: options?.signal,
    });
  }

  run(command: string, args: readonly string[]): Promise<ProcessRunResult> {
    return new Promise((resolve) => {
      const child = this.spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk.toString('utf8');
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);

      child.on('error', (error: Error) => {
        resolve({
          exitCode: 1,
          output: output + (error.message || String(error)),
        });
      });
      child.on('close', (code) => {
        resolve({ exitCode: code ?? 0, output });
      });
    });
  }

  runInteractive(command: string, args: readonly string[]): Promise<number> {
    return new Promise((resolve) => {
      const child = this.spawn(command, args, { stdio: 'inherit' });
      child.on('error', () => resolve(1));
      child.on('close', (code) => resolve(code ?? 0));
    });
  }

  reexec(): void {
    const child = this.spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}
