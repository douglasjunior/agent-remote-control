import { Injectable, Logger, Optional } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  IWorkspacePort,
  RepositoryMetadata,
} from '../ports/workspace.port.js';

const MANIFEST_FILENAME = 'workspace-manifest.json';

@Injectable()
export class LocalWorkspaceAdapter implements IWorkspacePort {
  private readonly logger = new Logger(LocalWorkspaceAdapter.name);
  private readonly baseDirectory: string;
  private readonly repositories = new Map<string, RepositoryMetadata>();
  private manifestLoaded = false;

  constructor(@Optional() customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDirectory = resolve(customBaseDir);
    } else if (process.env.WORKSPACE_DIR && process.env.WORKSPACE_DIR.trim()) {
      this.baseDirectory = resolve(process.env.WORKSPACE_DIR.trim());
    } else {
      this.baseDirectory = resolve(process.cwd(), 'workspaces');
    }
  }

  getBaseDirectory(): string {
    return this.baseDirectory;
  }

  resolveRepositoryPath(repositoryName: string): string {
    return resolve(this.baseDirectory, repositoryName);
  }

  async registerRepository(metadata: RepositoryMetadata): Promise<void> {
    await this.ensureManifestLoaded();
    this.repositories.set(metadata.name, metadata);
    await this.persistManifest();
  }

  async getRepository(
    repositoryName: string,
  ): Promise<RepositoryMetadata | null> {
    await this.ensureManifestLoaded();
    return this.repositories.get(repositoryName) ?? null;
  }

  async listRepositories(): Promise<RepositoryMetadata[]> {
    await this.ensureManifestLoaded();
    return Array.from(this.repositories.values());
  }

  async hasRepository(repositoryName: string): Promise<boolean> {
    await this.ensureManifestLoaded();
    if (this.repositories.has(repositoryName)) {
      return true;
    }
    const targetPath = this.resolveRepositoryPath(repositoryName);
    return existsSync(targetPath);
  }

  private async ensureManifestLoaded(): Promise<void> {
    if (this.manifestLoaded) {
      return;
    }
    this.manifestLoaded = true;

    const manifestPath = join(this.baseDirectory, MANIFEST_FILENAME);
    try {
      const content = await readFile(manifestPath, 'utf-8');
      const items = JSON.parse(content) as RepositoryMetadata[];
      for (const item of items) {
        if (item && item.name) {
          this.repositories.set(item.name, item);
        }
      }
    } catch (error) {
      this.logger.debug(`manifest_read_skipped: ${manifestPath}`);
    }
  }

  private async persistManifest(): Promise<void> {
    await mkdir(this.baseDirectory, { recursive: true });
    const manifestPath = join(this.baseDirectory, MANIFEST_FILENAME);
    const content = JSON.stringify(
      Array.from(this.repositories.values()),
      null,
      2,
    );
    await writeFile(manifestPath, content, 'utf-8');
  }
}
