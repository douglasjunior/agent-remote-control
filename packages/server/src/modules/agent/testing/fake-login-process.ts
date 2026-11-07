import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';


/** Stands in for a login CLI: specs print output with `print`, end it with `exit` and read what was written to stdin. */
export class FakeLoginProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly written: string[] = [];
  readonly killSignals: (NodeJS.Signals | number | undefined)[] = [];
  readonly stdin: { writable: boolean; write: (text: string) => boolean };

  constructor() {
    super();
    this.stdin = {
      writable: true,
      write: (text: string): boolean => {
        this.written.push(text);
        return true;
      },
    };
  }

  print(text: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    this[stream].emit('data', Buffer.from(text));
  }

  exit(code: number | null): void {
    this.emit('close', code);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    return true;
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}
