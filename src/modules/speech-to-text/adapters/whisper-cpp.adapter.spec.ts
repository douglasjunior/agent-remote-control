import { availableParallelism } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import type { IProcessRunnerPort, ProcessRunResult } from '../../agent/ports/process-runner.port.js';

import { WhisperCppAdapter } from './whisper-cpp.adapter.js';


const ENV_KEYS = ['STT_FFMPEG_BIN', 'STT_WHISPER_BIN', 'STT_MODEL_PATH', 'STT_MODEL', 'STT_LANGUAGE', 'STT_THREADS', 'STT_TIMEOUT_MS', 'DATA_DIR'];

describe('WhisperCppAdapter', () => {
  let runs: { command: string; args: readonly string[]; signal?: AbortSignal }[];
  let results: ProcessRunResult[];
  let deleted: string[];
  let transcriptText: string | null;
  let adapter: WhisperCppAdapter;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    runs = [];
    results = [];
    deleted = [];
    transcriptText = '  hello world \n';
    const runner = {
      run: async (command: string, args: readonly string[], options?: { signal?: AbortSignal }) => {
        runs.push({ command, args, signal: options?.signal });
        return results.shift() ?? { exitCode: 0, output: '' };
      },
    } as unknown as IProcessRunnerPort;
    const fileSystem = {
      joinPath: (...segments: string[]) => segments.join('/'),
      readText: async () => transcriptText,
      deleteFile: async (path: string) => { deleted.push(path); },
    } as unknown as IFileSystemPort;
    adapter = new WhisperCppAdapter(runner, fileSystem);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('should be enabled', () => {
    expect(adapter.isEnabled()).toBe(true);
  });

  it('should convert with ffmpeg, run whisper-cli with defaults and clean the temporary files', async () => {
    process.env.DATA_DIR = '/data';

    await expect(adapter.transcribe('/tmp/voice.ogg')).resolves.toBe('hello world');

    const [ffmpeg, whisper] = runs;
    expect(ffmpeg!.command).toBe('ffmpeg');
    const wavPath = ffmpeg!.args.at(-1)!;
    expect(wavPath).toMatch(/\/arc-stt-[\w-]+\.wav$/);
    expect(ffmpeg!.args).toEqual(['-y', '-i', '/tmp/voice.ogg', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
    const base = wavPath.replace(/\.wav$/, '');
    expect(whisper!.command).toBe('whisper-cli');
    expect(whisper!.args).toEqual([
      '-m', '/data/models/ggml-small.bin',
      '-f', wavPath,
      '-l', 'auto',
      '-t', String(availableParallelism()),
      '-nt', '-np',
      '-otxt', '-of', base,
    ]);
    expect(ffmpeg!.signal).toBeInstanceOf(AbortSignal);
    expect(deleted).toEqual([wavPath, `${base}.txt`]);
  });

  it('should derive the model file from STT_MODEL', async () => {
    process.env.DATA_DIR = '/data';
    process.env.STT_MODEL = 'large-v3-turbo-q5_0';

    await adapter.transcribe('/tmp/a.mp3');

    expect(runs[1]!.args).toEqual(expect.arrayContaining(['-m', '/data/models/ggml-large-v3-turbo-q5_0.bin']));
  });

  it('should honor the environment configuration and the language option', async () => {
    process.env.STT_FFMPEG_BIN = '/opt/ffmpeg';
    process.env.STT_WHISPER_BIN = '/opt/whisper';
    process.env.STT_MODEL_PATH = '/models/large.bin';
    process.env.STT_LANGUAGE = 'pt';
    process.env.STT_THREADS = '3';
    process.env.STT_TIMEOUT_MS = '1000';

    await adapter.transcribe('/tmp/a.mp3');
    await adapter.transcribe('/tmp/a.mp3', { language: 'en' });

    expect(runs[0]!.command).toBe('/opt/ffmpeg');
    expect(runs[1]!.command).toBe('/opt/whisper');
    expect(runs[1]!.args).toEqual(expect.arrayContaining(['-m', '/models/large.bin', '-l', 'pt', '-t', '3']));
    expect(runs[3]!.args).toEqual(expect.arrayContaining(['-l', 'en']));
  });

  it('should fall back to defaults for invalid numeric settings', async () => {
    process.env.STT_THREADS = 'abc';
    process.env.STT_TIMEOUT_MS = '-5';

    await adapter.transcribe('/tmp/a.mp3');

    expect(runs[1]!.args).toEqual(expect.arrayContaining(['-t', String(availableParallelism())]));
  });

  it('should return an empty text when whisper writes no transcript', async () => {
    transcriptText = null;

    await expect(adapter.transcribe('/tmp/a.mp3')).resolves.toBe('');
  });

  it('should fail with the tail of the output and still clean up when a command exits non-zero', async () => {
    results = [{ exitCode: 1, output: ` ${'x'.repeat(600)}Invalid data ` }];

    const error = await adapter.transcribe('/tmp/a.mp3').catch((caught: Error) => caught);

    expect((error as Error).message).toMatch(/^ffmpeg failed \(exit 1\): x+Invalid data$/);
    expect((error as Error).message.length).toBeLessThan(560);
    expect(runs).toHaveLength(1);
    expect(deleted).toHaveLength(2);
  });
});
