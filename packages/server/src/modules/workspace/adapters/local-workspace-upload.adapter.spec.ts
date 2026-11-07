import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workspaceDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { LocalWorkspaceUploadAdapter } from './local-workspace-upload.adapter.js';
import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


describe('LocalWorkspaceUploadAdapter', () => {
  let baseDirectory: string;
  let uploads: LocalWorkspaceUploadAdapter;
  const bytes = (text: string) => new TextEncoder().encode(text);

  beforeEach(() => {
    baseDirectory = mkdtempSync(join(tmpdir(), 'arc-upload-'));
    uploads = new LocalWorkspaceUploadAdapter(new LocalWorkspaceAdapter(workspaceDirectoryAt(baseDirectory)));
  });

  afterEach(() => {
    rmSync(baseDirectory, { recursive: true, force: true });
  });

  it('assembles the pieces into one file and returns its relative path', async () => {
    const writer = await uploads.begin('.arc-uploads/web-1', 'notes.txt');

    await writer.append(bytes('hello '));
    await writer.append(bytes('world'));
    const path = await writer.commit();

    expect(path).toBe('.arc-uploads/web-1/notes.txt');
    expect(readFileSync(join(baseDirectory, path), 'utf8')).toBe('hello world');
    expect(readdirSync(join(baseDirectory, '.arc-uploads/web-1'))).toEqual(['notes.txt']);
  });

  it('numbers a name that is already taken instead of overwriting it', async () => {
    const first = await uploads.begin('up', 'a.png');
    await first.append(bytes('one'));
    await first.commit();
    const second = await uploads.begin('up', 'a.png');
    await second.append(bytes('two'));
    const third = await uploads.begin('up', 'a.png');
    await third.append(bytes('three'));

    const secondPath = await second.commit();
    const thirdPath = await third.commit();

    expect([secondPath, thirdPath]).toEqual(['up/a (1).png', 'up/a (2).png']);
    expect(readFileSync(join(baseDirectory, 'up/a.png'), 'utf8')).toBe('one');
    expect(readFileSync(join(baseDirectory, secondPath), 'utf8')).toBe('two');
  });

  it('sanitizes the name so it cannot leave the directory', async () => {
    const writer = await uploads.begin('up', '../../outside.txt');
    await writer.append(bytes('x'));

    expect(await writer.commit()).toBe('up/outside.txt');
    expect(existsSync(join(baseDirectory, '..', 'outside.txt'))).toBe(false);
  });

  describe('the stored file name', () => {
    const storedName = async (name: string): Promise<string> => {
      const writer = await uploads.begin(`names/${randomUUID()}`, name);
      await writer.append(bytes('x'));
      return (await writer.commit()).split('/').at(-1)!;
    };

    it.each([
      ['report.pdf', 'report.pdf'],
      ['my photo (1).png', 'my photo (1).png'],
      ['../../etc/passwd', 'passwd'],
      ['C:\\Users\\me\\a.txt', 'a.txt'],
      ['.env', 'env'],
      ['..hidden.txt', 'hidden.txt'],
      ['a<b>:"c|d?e*.txt', 'a_b___c_d_e_.txt'],
      ['tab\there.txt', 'tab_here.txt'],
      ['   ', 'file'],
      ['', 'file'],
      ['folder/', 'file'],
    ])('turns %j into %j', async (name, expected) => {
      expect(await storedName(name)).toBe(expected);
    });

    it('shortens a long name and keeps the extension', async () => {
      const stored = await storedName(`${'a'.repeat(200)}.png`);

      expect(stored).toHaveLength(120);
      expect(stored.endsWith('.png')).toBe(true);
    });

    it('shortens a long name that has no usable extension', async () => {
      expect(await storedName('a'.repeat(200))).toHaveLength(120);
      expect(await storedName(`${'a'.repeat(200)}.${'b'.repeat(30)}`)).toHaveLength(120);
    });
  });

  it('leaves nothing behind when the upload is aborted', async () => {
    const writer = await uploads.begin('up', 'a.txt');
    await writer.append(bytes('partial'));

    await writer.abort();

    expect(readdirSync(join(baseDirectory, 'up'))).toEqual([]);
  });

  it('fails the commit when the target directory is gone', async () => {
    const writer = await uploads.begin('up', 'a.txt');
    await writer.append(bytes('x'));
    rmSync(join(baseDirectory, 'up'), { recursive: true, force: true });

    await expect(writer.commit()).rejects.toThrow();
  });

  it('gives up when every numbered name is taken', async () => {
    mkdirSync(join(baseDirectory, 'up'));
    writeFileSync(join(baseDirectory, 'up', 'a.txt'), '');
    for (let attempt = 1; attempt < 1_000; attempt += 1) {
      writeFileSync(join(baseDirectory, 'up', `a (${attempt}).txt`), '');
    }
    const writer = await uploads.begin('up', 'a.txt');

    await expect(writer.commit()).rejects.toThrow('No free name for upload');
  });

  it('refuses a directory outside the workspace', async () => {
    await expect(uploads.begin('../elsewhere', 'a.txt')).rejects.toThrow('outside the workspace');
  });

  it('reports the size of a file inside the workspace and nothing for anything else', async () => {
    mkdirSync(join(baseDirectory, 'up'));
    writeFileSync(join(baseDirectory, 'up', 'a.txt'), 'four');

    expect(await uploads.fileSize('up/a.txt')).toBe(4);
    expect(await uploads.fileSize('up')).toBeNull();
    expect(await uploads.fileSize('up/missing.txt')).toBeNull();
    expect(await uploads.fileSize('../a.txt')).toBeNull();
  });
});
