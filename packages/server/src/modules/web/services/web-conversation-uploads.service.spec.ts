import { describe, expect, it } from 'vitest';

import { FakeWorkspaceUpload } from '../testing/fake-workspace-upload.js';
import { StubWorkspacePort } from '../testing/stub-workspace.port.js';

import { WebConversationUploadsService } from './web-conversation-uploads.service.js';


function setup(...files: readonly string[]) {
  const uploads = new FakeWorkspaceUpload();
  files.forEach((file, index) => uploads.files.set(`.arc-uploads/web-1/${file}`, 100 + index));
  return new WebConversationUploadsService(new StubWorkspacePort(), uploads);
}

const attachment = (name: string) => ({ name, path: `.arc-uploads/web-1/${name}` });

describe('WebConversationUploadsService', () => {
  it('resolves the uploads of the conversation to absolute paths with their size', async () => {
    const service = setup('shot.png');

    await expect(service.resolve('web-1', [attachment('shot.png')])).resolves.toEqual([{ name: 'shot.png', path: '/workspaces/.arc-uploads/web-1/shot.png', contentType: 'image/png', size: 100 }]);
  });

  it.each([
    ['shot.png', 'image/png'],
    ['PHOTO.JPG', 'image/jpeg'],
    ['voice.ogg', 'audio/ogg'],
    ['voice.m4a', 'audio/mp4'],
    ['recording.webm', 'audio/webm'],
    ['notes.md', 'text/markdown'],
    ['archive.xyz', 'application/octet-stream'],
    ['no-extension', 'application/octet-stream'],
  ])('gives %s the content type %s, from its extension', async (name, contentType) => {
    const service = setup(name);

    const [file] = (await service.resolve('web-1', [attachment(name)]))!;

    expect(file!.contentType).toBe(contentType);
  });

  it('refuses the whole list when one file is not an existing upload of the conversation', async () => {
    const service = setup('shot.png');

    await expect(service.resolve('web-1', [attachment('shot.png'), attachment('missing.png')])).resolves.toBeNull();
    await expect(service.resolve('web-2', [attachment('shot.png')])).resolves.toBeNull();
  });
});
