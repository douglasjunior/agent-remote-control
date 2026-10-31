export type TranscribeOptions = {
  /** ISO 639-1 code such as "pt"; the provider detects the language when omitted. */
  readonly language?: string;
};

export interface ISpeechToTextPort {
  /** False when no provider is configured; callers then keep the audio as a regular attachment. */
  isEnabled(): boolean;
  /** Returns the transcribed text, empty when the audio has no speech. Rejects when transcription fails. */
  transcribe(audioPath: string, options?: TranscribeOptions): Promise<string>;
}

export const ISpeechToTextPort = Symbol('ISpeechToTextPort');
