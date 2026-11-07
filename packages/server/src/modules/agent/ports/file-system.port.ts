export type WriteOptions = {
  readonly mode?: number;
  readonly dirMode?: number;
};

export interface IFileSystemPort {
  isInPath(binary: string): boolean;
  resolveInPath(binary: string): string | null;
  isReadableDirectory(path: string): boolean;
  isReadableFile(path: string): boolean;
  readDirectoryNames(path: string): readonly string[];
  readJson<T>(filePath: string): Promise<T | null>;
  writeJson(
    filePath: string,
    data: unknown,
    options?: WriteOptions,
  ): Promise<void>;
  readText(filePath: string): Promise<string | null>;
  writeText(filePath: string, content: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  joinPath(...segments: string[]): string;
  resolvePath(path: string): string;
  resolveUserConfigDir(appName: string): string;
  watchDirectory(
    dirPath: string,
    onChange: (filename: string | null) => void,
  ): () => void;
}

export const IFileSystemPort = Symbol('IFileSystemPort');
