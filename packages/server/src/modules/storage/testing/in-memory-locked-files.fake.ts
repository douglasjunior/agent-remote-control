import type {
  ILockedFilesPort,
  JsonFileOptions,
  LockedFile,
  LockedFileChange,
  LockedFileOptions,
} from '../ports/locked-files.port.js';


/**
 * Files kept as text in `contents`, by path, so the parse and serialize of each store run as they do on disk. Updates
 * of one path run one at a time, in the order they were called.
 */
export class InMemoryLockedFilesFake implements ILockedFilesPort {
  readonly contents = new Map<string, string>();
  /** Rejects the next update with this error, leaving the file as it was. */
  failNextUpdate?: Error;
  private readonly tails = new Map<string, Promise<unknown>>();

  json<T>(path: string, options: JsonFileOptions<T>): LockedFile<T> {
    const { parse, empty, serialize = value => value } = options;
    return this.file(path, text => (text === undefined ? empty : this.parseJson(text, parse, empty)), value => JSON.stringify(serialize(value)));
  }

  text(path: string, _options?: LockedFileOptions): LockedFile<string | undefined> {
    return this.file<string | undefined>(path, text => text, value => value!);
  }

  private file<T>(path: string, decode: (text: string | undefined) => T, encode: (value: T) => string): LockedFile<T> {
    const read = async () => decode(this.contents.get(path));
    return {
      read,
      update: (change: LockedFileChange<T>) => {
        const run = (this.tails.get(path) ?? Promise.resolve()).then(async () => {
          const failure = this.failNextUpdate;
          if (failure) {
            this.failNextUpdate = undefined;
            throw failure;
          }
          const current = await read();
          const next = await change(current);
          if (next === undefined) {
            return current;
          }
          this.contents.set(path, encode(next));
          return next;
        });
        this.tails.set(path, run.catch(() => undefined));
        return run;
      },
    };
  }

  private parseJson<T>(text: string, parse: (content: unknown) => T, empty: T): T {
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      return empty;
    }
    return parse(content);
  }
}
