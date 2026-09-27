import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type DiscordAttachment,
  DiscordAttachmentService,
} from './discord-attachment.service.js';


vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { mkdir, writeFile } = await import('node:fs/promises');

describe('DiscordAttachmentService', () => {
  let service: DiscordAttachmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DiscordAttachmentService();
  });

  describe('validateAttachment', () => {
    it.each([
      ['image/png', 'photo.png', 'image/png'],
      ['image/jpeg', 'photo.jpg', 'image/jpeg'],
      ['image/webp', 'photo.webp', 'image/webp'],
      ['image/gif', 'anim.gif', 'image/gif'],
      ['text/markdown', 'readme.md', 'text/markdown'],
      ['text/plain', 'notes.txt', 'text/plain'],
      ['application/pdf', 'doc.pdf', 'application/pdf'],
      ['code ts', 'index.ts', 'application/octet-stream'],
      ['code py', 'script.py', 'text/x-python'],
      ['json', 'data.json', 'application/json'],
      ['audio', 'audio.mp3', 'audio/mpeg'],
      ['video', 'clip.mp4', 'video/mp4'],
      ['exact Dockerfile', 'Dockerfile', 'application/octet-stream'],
      ['exact .env', '.env', 'application/octet-stream'],
      ['mime prefix image', null, 'image/png'],
      ['mime prefix text', null, 'text/plain'],
      ['supported mime type', null, 'application/pdf'],
    ])('should accept supported format: %s', (_label, name, contentType) => {
      const attachment: DiscordAttachment = {
        name,
        url: 'https://cdn.discordapp.com/attachments/1/2/file',
        contentType,
        size: 1024,
      };

      const result = service.validateAttachment(attachment);

      expect(result).toEqual({ valid: true });
    });

    it('should reject file that exceeds maximum size of 100 MB', () => {
      const attachment: DiscordAttachment = {
        name: 'huge.pdf',
        url: 'https://cdn.discordapp.com/attachments/1/2/huge.pdf',
        contentType: 'application/pdf',
        size: 101 * 1024 * 1024,
      };

      const result = service.validateAttachment(attachment);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('excede o tamanho limite de 100 MB');
      }
    });

    it('should reject nameless file that exceeds maximum size of 100 MB', () => {
      const attachment: DiscordAttachment = {
        name: null,
        url: 'https://cdn.discordapp.com/attachments/1/2/huge.pdf',
        contentType: 'application/pdf',
        size: 101 * 1024 * 1024,
      };

      const result = service.validateAttachment(attachment);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('anexo');
      }
    });

    it('should reject nameless file with blocked mime type', () => {
      const attachment: DiscordAttachment = {
        name: null,
        url: 'https://cdn.discordapp.com/attachments/1/2/file',
        contentType: 'application/x-msdownload',
        size: 1024,
      };

      const result = service.validateAttachment(attachment);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('anexo');
      }
    });

    it.each([
      ['.exe', 'malware.exe', 'application/x-msdownload'],
      ['.bin', 'firmware.bin', 'application/octet-stream'],
      ['.dll', 'library.dll', 'application/x-msdownload'],
      ['.so', 'lib.so', 'application/octet-stream'],
      ['.zip', 'archive.zip', 'application/zip'],
      ['blocked mime type', 'file', 'application/x-executable'],
      ['unknown binary format', 'data.xyz123', 'application/octet-stream'],
      ['unknown format without name or mime', null, null],
    ])('should reject incompatible format: %s', (_label, name, contentType) => {
      const attachment: DiscordAttachment = {
        name,
        url: 'https://cdn.discordapp.com/attachments/1/2/file',
        contentType,
        size: 2048,
      };

      const result = service.validateAttachment(attachment);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('possui um formato não suportado ou incompatível');
      }
    });
  });

  describe('validateAttachments', () => {
    it('should return valid true when all attachments are compatible', () => {
      const attachments: DiscordAttachment[] = [
        {
          name: 'doc.pdf',
          url: 'https://cdn.discordapp.com/attachments/1/2/doc.pdf',
          contentType: 'application/pdf',
          size: 1024,
        },
        {
          name: 'code.ts',
          url: 'https://cdn.discordapp.com/attachments/1/2/code.ts',
          contentType: 'text/plain',
          size: 512,
        },
      ];

      const result = service.validateAttachments(attachments);

      expect(result).toEqual({ valid: true });
    });

    it('should return valid false when any attachment is incompatible', () => {
      const attachments: DiscordAttachment[] = [
        {
          name: 'doc.pdf',
          url: 'https://cdn.discordapp.com/attachments/1/2/doc.pdf',
          contentType: 'application/pdf',
          size: 1024,
        },
        {
          name: 'setup.exe',
          url: 'https://cdn.discordapp.com/attachments/1/2/setup.exe',
          contentType: 'application/octet-stream',
          size: 2048,
        },
      ];

      const result = service.validateAttachments(attachments);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('setup.exe');
      }
    });

    it('should return valid true for empty list of attachments', () => {
      const result = service.validateAttachments([]);
      expect(result).toEqual({ valid: true });
    });
  });

  describe('downloadAttachments', () => {
    it('should download attachments and return TurnAttachment array', async () => {
      const fileBytes = Buffer.from('file-content');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
      } as Response);

      const attachments: DiscordAttachment[] = [
        {
          name: 'report.pdf',
          url: 'https://cdn.discordapp.com/attachments/1/2/report.pdf',
          contentType: 'application/pdf',
          size: fileBytes.length,
        },
      ];

      const results = await service.downloadAttachments('ch-1:th-1', attachments);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/attachments/1/2/report.pdf',
        {
          signal: expect.any(AbortSignal),
        },
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        name: 'report.pdf',
        contentType: 'application/pdf',
        size: fileBytes.length,
        url: 'https://cdn.discordapp.com/attachments/1/2/report.pdf',
      });
      expect(results[0]!.path).toContain('report.pdf');
      expect(results[0]!.path).toContain('ch-1_th-1');
    });

    it('should configure fetch request with timeout abort signal', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const fileBytes = Buffer.from('test');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => fileBytes.buffer,
      } as Response);

      await service.downloadAttachments('ch-1', [
        {
          name: 'test.txt',
          url: 'https://cdn.discordapp.com/attachments/1/2/test.txt',
          contentType: 'text/plain',
          size: 4,
        },
      ]);

      expect(timeoutSpy).toHaveBeenCalledWith(60_000);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/attachments/1/2/test.txt',
        {
          signal: expect.any(AbortSignal),
        },
      );
    });

    it('should throw error when download aborts due to timeout', async () => {
      const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeoutError);

      const attachments: DiscordAttachment[] = [
        {
          name: 'large.mp4',
          url: 'https://cdn.discordapp.com/attachments/1/2/large.mp4',
          contentType: 'video/mp4',
          size: 50 * 1024 * 1024,
        },
      ];

      await expect(service.downloadAttachments('ch-1', attachments)).rejects.toThrow(
        'Falha ao baixar o anexo "large.mp4": The operation was aborted due to timeout',
      );
    });

    it('should sanitize path traversal characters in attachment names', async () => {
      const fileBytes = Buffer.from('test');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => fileBytes.buffer,
      } as Response);

      const attachments: DiscordAttachment[] = [
        {
          name: '../../../../etc/passwd',
          url: 'https://cdn.discordapp.com/attachments/1/2/passwd',
          contentType: 'text/plain',
          size: 4,
        },
      ];

      const results = await service.downloadAttachments('ch-1', attachments);

      expect(results[0]!.path).not.toContain('..');
      expect(results[0]!.path).toContain('passwd');
      expect(results[0]!.name).toBe('passwd');
    });

    it('should handle attachment with null name and null contentType', async () => {
      const fileBytes = Buffer.from('test');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => fileBytes.buffer,
      } as Response);

      const attachments: DiscordAttachment[] = [
        {
          name: null,
          url: 'https://cdn.discordapp.com/attachments/1/2/file',
          contentType: null,
          size: 4,
        },
      ];

      const results = await service.downloadAttachments('ch-1', attachments);

      expect(results[0]!.name).toBe('attachment');
      expect(results[0]!.contentType).toBe('application/octet-stream');
    });

    it('should throw error when download HTTP request fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const attachments: DiscordAttachment[] = [
        {
          name: 'missing.png',
          url: 'https://cdn.discordapp.com/attachments/1/2/missing.png',
          contentType: 'image/png',
          size: 100,
        },
      ];

      await expect(service.downloadAttachments('ch-1', attachments)).rejects.toThrow(
        'Falha ao baixar o anexo "missing.png": HTTP 404 Not Found',
      );
    });

    it('should throw error when fetch throws network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection reset'));

      const attachments: DiscordAttachment[] = [
        {
          name: 'broken.png',
          url: 'https://cdn.discordapp.com/attachments/1/2/broken.png',
          contentType: 'image/png',
          size: 100,
        },
      ];

      await expect(service.downloadAttachments('ch-1', attachments)).rejects.toThrow(
        'Falha ao baixar o anexo "broken.png": Connection reset',
      );
    });

    it('should throw error when fetch throws non-Error object', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue('Network timeout string');

      const attachments: DiscordAttachment[] = [
        {
          name: 'broken.png',
          url: 'https://cdn.discordapp.com/attachments/1/2/broken.png',
          contentType: 'image/png',
          size: 100,
        },
      ];

      await expect(service.downloadAttachments('ch-1', attachments)).rejects.toThrow(
        'Falha ao baixar o anexo "broken.png": Network timeout string',
      );
    });

    it('should omit url property when attachment url is empty', async () => {
      const fileBytes = Buffer.from('test');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
      } as Response);

      const attachments: DiscordAttachment[] = [
        {
          name: 'file.txt',
          url: '',
          contentType: 'text/plain',
          size: 4,
        },
      ];

      const results = await service.downloadAttachments('ch-1', attachments);

      expect(results[0]!.url).toBeUndefined();
    });
  });
});
