import type { IFileSystemPort } from '../ports/file-system.port.js';


/** Backed by state where specs observe or steer the adapters: binaries in PATH, readable files, deleted files and read text. */
export class StubFileSystem implements IFileSystemPort {
  readonly binaries = new Map<string, string>();
  readonly readableFiles = new Set<string>();
  readonly deletedFiles: string[] = [];
  /** Decides readability for paths a spec cannot list, such as ones under the module's install directory. */
  isReadable?: (path: string) => boolean;
  /** What `readText` returns for every path. */
  text: string | null = null;

  addBinary(binary: string, path = `/usr/bin/${binary}`): this {
    this.binaries.set(binary, path);
    return this;
  }

  isInPath(binary: string): boolean {
    return this.binaries.has(binary);
  }

  resolveInPath(binary: string): string | null {
    return this.binaries.get(binary) ?? null;
  }

  isReadableFile(path: string): boolean {
    return this.readableFiles.has(path) || (this.isReadable?.(path) ?? false);
  }

  async readText(): Promise<string | null> {
    return this.text;
  }

  readonly executables = new Map<string, string>();

  async writeExecutable(filePath: string, content: string): Promise<void> {
    this.executables.set(filePath, content);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.deletedFiles.push(filePath);
  }

  joinPath(...segments: string[]): string {
    return segments.join('/');
  }

  isReadableDirectory(): boolean {
    return false;
  }

  readDirectoryNames(): readonly string[] {
    return [];
  }

  async readJson<T>(): Promise<T | null> {
    return null;
  }

  async writeJson(): Promise<void> {
    return undefined;
  }

  async writeText(): Promise<void> {
    return undefined;
  }

  resolvePath(path: string): string {
    return path;
  }

  resolveUserConfigDir(appName: string): string {
    return `/config/${appName}`;
  }

  watchDirectory(): () => void {
    return () => undefined;
  }
}
