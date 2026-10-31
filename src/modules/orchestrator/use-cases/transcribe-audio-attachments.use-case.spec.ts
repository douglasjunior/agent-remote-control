import { beforeEach, describe, expect, it } from 'vitest';

import type { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { StubSpeechToText } from '../../speech-to-text/testing/stub-speech-to-text.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';

import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


const attachment = (name: string, contentType: string): TurnAttachment => ({
  name,
  path: `/tmp/${name}`,
  contentType,
  size: 10,
});

describe('TranscribeAudioAttachmentsUseCase', () => {
  let speechToText: StubSpeechToText;
  let deleted: string[];
  let useCase: TranscribeAudioAttachmentsUseCase;

  beforeEach(() => {
    speechToText = new StubSpeechToText();
    deleted = [];
    const fileSystem = {
      deleteFile: async (path: string) => {
        deleted.push(path);
      },
    } as unknown as IFileSystemPort;
    useCase = new TranscribeAudioAttachmentsUseCase(speechToText, fileSystem);
  });

  it('should pass the input through when there are no attachments', async () => {
    await expect(useCase.execute({ prompt: 'hello' })).resolves.toEqual({
      prompt: 'hello',
      attachments: [],
      transcripts: [],
      warnings: [],
    });
  });

  it('should pass the input through when there is no audio', async () => {
    const image = attachment('diagram.png', 'image/png');

    const result = await useCase.execute({ prompt: 'look', attachments: [image] });

    expect(result).toEqual({ prompt: 'look', attachments: [image], transcripts: [], warnings: [] });
    expect(speechToText.calls).toEqual([]);
  });

  it('should keep audio as an attachment when speech-to-text is disabled', async () => {
    speechToText.enabled = false;
    const audio = attachment('voice.ogg', 'audio/ogg');

    const result = await useCase.execute({ prompt: '', attachments: [audio] });

    expect(result.attachments).toEqual([audio]);
    expect(speechToText.calls).toEqual([]);
  });

  it('should use the transcript as the prompt and drop the audio', async () => {
    speechToText.transcripts['/tmp/voice.ogg'] = '  run the tests  ';

    const result = await useCase.execute({ prompt: '', attachments: [attachment('voice.ogg', 'audio/ogg')] });

    expect(result).toEqual({
      prompt: 'run the tests',
      attachments: [],
      transcripts: [{ name: 'voice.ogg', text: 'run the tests' }],
      warnings: [],
    });
    expect(deleted).toEqual(['/tmp/voice.ogg']);
  });

  it('should append the transcript to the typed text and keep non-audio attachments', async () => {
    speechToText.transcripts['/tmp/voice.ogg'] = 'fix the bug';
    const image = attachment('shot.png', 'image/png');

    const result = await useCase.execute({
      prompt: ' See the screenshot. ',
      attachments: [image, attachment('voice.ogg', 'audio/ogg')],
    });

    expect(result.prompt).toBe('See the screenshot.\n\nfix the bug');
    expect(result.attachments).toEqual([image]);
  });

  it('should label each transcript when there are several audios', async () => {
    speechToText.transcripts['/tmp/a.ogg'] = 'first';
    speechToText.transcripts['/tmp/b.mp3'] = 'second';

    const result = await useCase.execute({
      prompt: '',
      attachments: [attachment('a.ogg', 'audio/ogg'), attachment('b.mp3', 'audio/mpeg')],
    });

    expect(result.prompt).toBe('[Audio: a.ogg]\nfirst\n\n[Audio: b.mp3]\nsecond');
  });

  it('should keep the audio and warn when no speech is detected', async () => {
    const audio = attachment('silence.ogg', 'audio/ogg');

    const result = await useCase.execute({ prompt: 'typed', attachments: [audio] });

    expect(result.prompt).toBe('typed');
    expect(result.attachments).toEqual([audio]);
    expect(result.transcripts).toEqual([]);
    expect(result.warnings).toEqual(['⚠️ No speech was detected in "silence.ogg"; it was sent to the agent as an attachment.']);
    expect(deleted).toEqual([]);
  });

  it('should keep the audio and warn when the transcription fails', async () => {
    speechToText.failures['/tmp/bad.ogg'] = 'ffmpeg failed';
    speechToText.transcripts['/tmp/good.ogg'] = 'hello';
    const bad = attachment('bad.ogg', 'audio/ogg');

    const result = await useCase.execute({ prompt: '', attachments: [bad, attachment('good.ogg', 'audio/ogg')] });

    expect(result.prompt).toBe('hello');
    expect(result.attachments).toEqual([bad]);
    expect(result.warnings).toEqual(['⚠️ Could not transcribe "bad.ogg" (ffmpeg failed); it was sent to the agent as an attachment.']);
  });

  it('should describe non-Error failures', async () => {
    speechToText.transcribe = async () => {
      throw 'boom';
    };

    const result = await useCase.execute({ prompt: '', attachments: [attachment('x.ogg', 'audio/ogg')] });

    expect(result.warnings[0]).toContain('(boom)');
  });
});
