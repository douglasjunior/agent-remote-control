import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { availableParallelism, tmpdir } from 'node:os';

import { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { IProcessRunnerPort } from '../../agent/ports/process-runner.port.js';
import { resolveDataDirectory } from '../../orchestrator/utils/data-directory.util.js';
import type { ISpeechToTextPort, TranscribeOptions } from '../ports/speech-to-text.port.js';


const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MODEL = 'small';

/** CPU transcription with the whisper.cpp `whisper-cli` binary; ffmpeg converts any input to 16 kHz mono WAV. */
@Injectable()
export class WhisperCppAdapter implements ISpeechToTextPort {
  constructor(
    @Inject(IProcessRunnerPort) private readonly processRunner: IProcessRunnerPort,
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
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
        '-l', options?.language ?? process.env.STT_LANGUAGE?.trim() ?? 'auto',
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
    return process.env.STT_FFMPEG_BIN?.trim() || 'ffmpeg';
  }

  private whisperBin(): string {
    return process.env.STT_WHISPER_BIN?.trim() || 'whisper-cli';
  }

  private modelPath(): string {
    const model = process.env.STT_MODEL?.trim() || DEFAULT_MODEL;
    return process.env.STT_MODEL_PATH?.trim()
      || this.fileSystem.joinPath(resolveDataDirectory(), 'models', `ggml-${model}.bin`);
  }

  private threads(): number {
    const configured = Number(process.env.STT_THREADS);
    return Number.isInteger(configured) && configured > 0 ? configured : availableParallelism();
  }

  private timeoutMs(): number {
    const configured = Number(process.env.STT_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  }
}
