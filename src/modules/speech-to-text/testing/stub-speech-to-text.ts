import type { ISpeechToTextPort, TranscribeOptions } from '../ports/speech-to-text.port.js';


export class StubSpeechToText implements ISpeechToTextPort {
  enabled = true;
  /** Text by audio path; a missing path yields an empty transcription. */
  transcripts: Record<string, string> = {};
  /** Error message by audio path; the transcription rejects with it. */
  failures: Record<string, string> = {};
  readonly calls: { audioPath: string; options?: TranscribeOptions }[] = [];

  isEnabled(): boolean {
    return this.enabled;
  }

  async transcribe(audioPath: string, options?: TranscribeOptions): Promise<string> {
    this.calls.push({ audioPath, options });
    const failure = this.failures[audioPath];
    if (failure) {
      throw new Error(failure);
    }
    return this.transcripts[audioPath] ?? '';
  }
}
