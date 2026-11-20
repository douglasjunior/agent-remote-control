import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { availableParallelism, tmpdir } from 'node:os';

import { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { IProcessRunnerPort } from '../../agent/ports/process-runner.port.js';
import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { IRuntimeSettingsPort } from '../../settings/ports/runtime-settings.port.js';
import type { ISpeechToTextPort, TranscribeOptions } from '../ports/speech-to-text.port.js';


/** CPU transcription with the whisper.cpp `whisper-cli` binary; ffmpeg converts any input to 16 kHz mono WAV. */
@Injectable()
export class WhisperCppAdapter implements ISpeechToTextPort {
  constructor(
    @Inject(IProcessRunnerPort) private readonly processRunner: IProcessRunnerPort,
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    private readonly dataDirectory: DataDirectoryService,
    @Inject(IRuntimeSettingsPort) private readonly settings: IRuntimeSettingsPort,
  ) {}

  isEnabled(): boolean {
    return true;
  }

  async transcribe(audioPath: string, options?: TranscribeOptions): Promise<string> {
    const workBase = this.fileSystem.joinPath(tmpdir(), `arc-stt-${randomUUID()}`);
    const wavPath = `${workBase}.wav`;
    const textPath = `${workBase}.txt`;
    try {
      await this.run(this.ffmpegBin(), ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
      await this.run(this.whisperBin(), [
        '-m', this.modelPath(),
        '-f', wavPath,
        '-l', options?.language ?? this.settings.get('STT_LANGUAGE'),
        '-t', String(this.threads()),
        '-nt', '-np',
        '-otxt', '-of', workBase,
      ]);
      return ((await this.fileSystem.readText(textPath)) ?? '').trim();
    } finally {
      await this.fileSystem.deleteFile(wavPath);
      await this.fileSystem.deleteFile(textPath);
    }
  }

  private async run(command: string, args: readonly string[]): Promise<void> {
    const result = await this.processRunner.run(command, args, { signal: AbortSignal.timeout(this.timeoutMs()) });
    if (result.exitCode !== 0) {
      throw new Error(`${command} failed (exit ${result.exitCode}): ${result.output.trim().slice(-500)}`);
    }
  }

  private ffmpegBin(): string {
    return this.settings.get('STT_FFMPEG_BIN');
  }

  private whisperBin(): string {
    return this.settings.get('STT_WHISPER_BIN');
  }

  private modelPath(): string {
    return this.settings.get('STT_MODEL_PATH')
      || this.fileSystem.joinPath(this.dataDirectory.resolve(), 'models', `ggml-${this.settings.get('STT_MODEL')}.bin`);
  }

  /** `0` uses every CPU. */
  private threads(): number {
    return this.settings.get('STT_THREADS') || availableParallelism();
  }

  private timeoutMs(): number {
    return this.settings.get('STT_TIMEOUT_MS');
  }
}
