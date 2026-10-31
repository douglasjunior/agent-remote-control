import { extname } from 'node:path';

import type { TurnAttachment } from '../models/turn-attachment.model.js';


const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac']);

export function isAudioAttachment(attachment: TurnAttachment): boolean {
  const contentType = attachment.contentType.toLowerCase();
  return contentType.startsWith('audio/') || AUDIO_EXTENSIONS.has(extname(attachment.name).toLowerCase());
}
