import type { IFileSystemPort } from '../../agent/ports/file-system.port.js';


/** Only what the orchestrator uses is backed by state: `readableFiles` and `deletedFiles`. */
export class StubFileSystem implements IFileSystemPort {
  readonly readableFiles = new Set<string>();
  readonly deletedFiles: string[] = [];

  isReadableFile(path: string): boolean {
    return this.readableFiles.has(path);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.deletedFiles.push(filePath);
  }

  isInPath(): boolean {
    return false;
  }

  resolveInPath(): string | null {
    return null;
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

  async readText(): Promise<string | null> {
    return null;
  }

  async writeText(): Promise<void> {
    return undefined;
  }

  joinPath(...segments: string[]): string {
    return segments.join('/');
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
