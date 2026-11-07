import type { IWorkspaceUploadPort, UploadWriter } from '../../workspace/ports/workspace-upload.port.js';


export class FakeUploadWriter implements UploadWriter {
  readonly chunks: Uint8Array[] = [];
  committed = false;
  aborted = false;

  constructor(readonly directory: string, readonly name: string) {}

  async append(bytes: Uint8Array): Promise<void> {
    this.chunks.push(bytes);
  }

  async commit(): Promise<string> {
    this.committed = true;
    return `${this.directory}/${this.name}`;
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

export class FakeWorkspaceUpload implements IWorkspaceUploadPort {
  readonly writers: FakeUploadWriter[] = [];
  /** Size by path of the files that exist. */
  readonly files = new Map<string, number>();

  async begin(directory: string, name: string): Promise<UploadWriter> {
    const writer = new FakeUploadWriter(directory, name);
    this.writers.push(writer);
    return writer;
  }

  async fileSize(relativePath: string): Promise<number | null> {
    return this.files.get(relativePath) ?? null;
  }
}
