import { Inject, Injectable } from '@nestjs/common';
import { extname } from 'node:path';

import { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { ISpeechToTextPort } from '../../speech-to-text/ports/speech-to-text.port.js';
import type { AudioTranscript, AudioTranscriptionResult } from '../models/audio-transcription.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';


const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac']);

export type TranscribeAudioAttachmentsInput = {
  readonly prompt: string;
  readonly attachments?: readonly TurnAttachment[];
};

@Injectable()
export class TranscribeAudioAttachmentsUseCase {
  constructor(
    @Inject(ISpeechToTextPort) private readonly speechToText: ISpeechToTextPort,
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
  ) {}

  async execute(input: TranscribeAudioAttachmentsInput): Promise<AudioTranscriptionResult> {
    const attachments = input.attachments ?? [];
    if (!this.speechToText.isEnabled() || !attachments.some(attachment => this.isAudio(attachment))) {
      return { prompt: input.prompt, attachments, transcripts: [], warnings: [] };
    }

    const transcripts: AudioTranscript[] = [];
    const warnings: string[] = [];
    const remaining: TurnAttachment[] = [];

    for (const attachment of attachments) {
      if (!this.isAudio(attachment)) {
        remaining.push(attachment);
        continue;
      }
      try {
        const text = (await this.speechToText.transcribe(attachment.path)).trim();
        if (!text) {
          warnings.push(`⚠️ No speech was detected in "${attachment.name}"; it was sent to the agent as an attachment.`);
          remaining.push(attachment);
          continue;
        }
        transcripts.push({ name: attachment.name, text });
        await this.fileSystem.deleteFile(attachment.path);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warnings.push(`⚠️ Could not transcribe "${attachment.name}" (${reason}); it was sent to the agent as an attachment.`);
        remaining.push(attachment);
      }
    }

    return { prompt: this.composePrompt(input.prompt, transcripts), attachments: remaining, transcripts, warnings };
  }

  private isAudio(attachment: TurnAttachment): boolean {
    const contentType = attachment.contentType.toLowerCase();
    return contentType.startsWith('audio/') || AUDIO_EXTENSIONS.has(extname(attachment.name).toLowerCase());
  }

  private composePrompt(typedText: string, transcripts: readonly AudioTranscript[]): string {
    const spoken = transcripts.length === 1
      ? [transcripts[0]!.text]
      : transcripts.map(transcript => `[Audio: ${transcript.name}]\n${transcript.text}`);
    return [typedText.trim(), ...spoken].filter(Boolean).join('\n\n');
  }
}
