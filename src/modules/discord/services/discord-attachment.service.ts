import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';


export type DiscordAttachment = {
  readonly name: string | null;
  readonly url: string;
  readonly contentType: string | null;
  readonly size: number;
};

export type AttachmentValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bin', '.dll', '.so', '.dylib', '.class', '.pyc', '.pyo',
  '.o', '.obj', '.a', '.lib', '.iso', '.img', '.dmg', '.vmdk',
  '.msi', '.deb', '.rpm', '.apk', '.ipa', '.com',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-sharedlib',
  'application/x-object',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
]);

const SUPPORTED_MIME_PREFIXES = ['text/', 'image/', 'audio/', 'video/'];

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/atom+xml',
  'application/rss+xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-sh',
  'application/x-bash',
  'application/x-csh',
  'application/x-zsh',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/x-toml',
  'application/sql',
  'application/graphql',
  'application/csv',
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.svg', '.ico',
  '.pdf', '.txt', '.rtf', '.md', '.markdown', '.rst', '.adoc', '.asciidoc',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
  '.py', '.pyw',
  '.rb', '.erb',
  '.php',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx',
  '.cs',
  '.go',
  '.rs',
  '.swift',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.lua', '.r', '.dart', '.sql',
  '.json', '.jsonc', '.jsonl',
  '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.properties', '.env',
  '.xml', '.graphql', '.gql', '.proto', '.prisma',
  '.csv', '.tsv', '.log', '.diff', '.patch', '.dockerfile',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
  '.mp4', '.webm', '.mkv', '.avi', '.mov',
]);

const SUPPORTED_EXACT_NAMES = new Set([
  'dockerfile', 'makefile', 'license', 'readme',
  '.gitignore', '.env', '.editorconfig', '.npmrc',
  '.prettierrc', '.eslintrc',
]);

@Injectable()
export class DiscordAttachmentService {
  private readonly logger = new Logger(DiscordAttachmentService.name);

  validateAttachment(attachment: DiscordAttachment): AttachmentValidationResult {
    const rawName = attachment.name ? basename(attachment.name) : '';
    const ext = rawName.includes('.') ? `.${rawName.split('.').pop()!.toLowerCase()}` : '';
    const mime = attachment.contentType ? attachment.contentType.toLowerCase().split(';')[0]!.trim() : '';

    if (attachment.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        reason: `⚠️ O arquivo "${rawName || 'anexo'}" excede o tamanho limite de 100 MB suportado pelas ferramentas de inspeção do agente.`,
      };
    }

    if (ext && BLOCKED_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        reason: `⚠️ O arquivo "${rawName}" possui um formato não suportado ou incompatível com as ferramentas do agente. Por favor, envie arquivos de texto, código, imagens, áudio, vídeo ou PDF.`,
      };
    }

    if (mime && BLOCKED_MIME_TYPES.has(mime)) {
      return {
        valid: false,
        reason: `⚠️ O arquivo "${rawName || 'anexo'}" possui um formato não suportado ou incompatível com as ferramentas do agente. Por favor, envie arquivos de texto, código, imagens, áudio, vídeo ou PDF.`,
      };
    }

    if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
      return { valid: true };
    }

    if (rawName && SUPPORTED_EXACT_NAMES.has(rawName.toLowerCase())) {
      return { valid: true };
    }

    if (mime) {
      if (SUPPORTED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) {
        return { valid: true };
      }
      if (SUPPORTED_MIME_TYPES.has(mime)) {
        return { valid: true };
      }
    }

    return {
      valid: false,
      reason: `⚠️ O arquivo "${rawName || 'anexo'}" possui um formato não suportado ou incompatível com as ferramentas do agente. Por favor, envie arquivos de texto, código, imagens, áudio, vídeo ou PDF.`,
    };
  }

  validateAttachments(attachments: readonly DiscordAttachment[]): AttachmentValidationResult {
    for (const attachment of attachments) {
      const result = this.validateAttachment(attachment);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  }

  async downloadAttachments(
    conversationKey: string,
    attachments: readonly DiscordAttachment[],
  ): Promise<TurnAttachment[]> {
    const sanitizedKey = conversationKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const conversationDir = join(tmpdir(), 'agent-remote-control', 'attachments', sanitizedKey);
    await mkdir(conversationDir, { recursive: true });

    return await Promise.all(
      attachments.map(att => this.downloadSingleAttachment(conversationDir, att)),
    );
  }

  private async downloadSingleAttachment(
    directory: string,
    attachment: DiscordAttachment,
  ): Promise<TurnAttachment> {
    const rawName = attachment.name ? basename(attachment.name) : 'attachment';
    const sanitizedBase = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniquePrefix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const fileName = `${uniquePrefix}-${sanitizedBase}`;
    const destinationPath = join(directory, fileName);

    try {
      this.logger.log(`[Attachment Downloading] "${rawName}" from ${attachment.url} to ${destinationPath}`);
      const response = await fetch(attachment.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await writeFile(destinationPath, buffer);
      this.logger.log(`[Attachment Downloaded] "${rawName}" (${buffer.length} bytes) at ${destinationPath}`);

      return {
        name: rawName,
        path: destinationPath,
        contentType: attachment.contentType || 'application/octet-stream',
        size: buffer.length,
        ...(attachment.url ? { url: attachment.url } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Attachment Download Failed] "${rawName}" from ${attachment.url}: ${errorMessage}`);
      throw new Error(`Falha ao baixar o anexo "${rawName}": ${errorMessage}`);
    }
  }
}
