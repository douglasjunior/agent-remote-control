import { describe, expect, it } from 'vitest';

import { isAudioAttachment } from './audio-attachment.util.js';


const attachment = (name: string, contentType: string) => ({ name, path: `/tmp/${name}`, contentType, size: 1 });

describe('isAudioAttachment', () => {
  it('should recognize audio by content type', () => {
    expect(isAudioAttachment(attachment('voice-message', 'audio/ogg'))).toBe(true);
    expect(isAudioAttachment(attachment('note', 'AUDIO/MPEG'))).toBe(true);
  });

  it('should recognize audio by extension when the content type is generic', () => {
    expect(isAudioAttachment(attachment('Memo.M4A', 'application/octet-stream'))).toBe(true);
  });

  it('should not treat other files as audio', () => {
    expect(isAudioAttachment(attachment('diagram.png', 'image/png'))).toBe(false);
    expect(isAudioAttachment(attachment('clip.mp4', 'video/mp4'))).toBe(false);
  });
});
