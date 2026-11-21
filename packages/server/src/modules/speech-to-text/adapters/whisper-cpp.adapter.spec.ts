import { beforeEach, describe, expect, it } from '@rstest/core';
import { availableParallelism } from 'node:os';

import type { IProcessRunnerPort, ProcessRunResult } from '../../agent/ports/process-runner.port.js';
import { StubFileSystem } from '../../agent/testing/stub-file-system.port.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { WhisperCppAdapter } from './whisper-cpp.adapter.js';


describe('WhisperCppAdapter', () => {
  let runs: { command: string; args: readonly string[]; signal?: AbortSignal }[];
  let results: ProcessRunResult[];
  let fileSystem: StubFileSystem;
  let adapter: WhisperCppAdapter;
  let settings: StubRuntimeSettings;

  beforeEach(() => {
    settings = new StubRuntimeSettings();
    runs = [];
    results = [];
    fileSystem = new StubFileSystem();
    fileSystem.text = '  hello world \n';
    const runner = {
      run: async (command: string, args: readonly string[], options?: { signal?: AbortSignal }) => {
        runs.push({ command, args, signal: options?.signal });
        return results.shift() ?? { exitCode: 0, output: '' };
      },
    } as unknown as IProcessRunnerPort;
    adapter = new WhisperCppAdapter(runner, fileSystem, dataDirectoryAt('/data'), settings);
  });

  it('should be enabled', () => {
    expect(adapter.isEnabled()).toBe(true);
  });

  it('should convert with ffmpeg, run whisper-cli with defaults and clean the temporary files', async () => {
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
    expect(ffmpeg!.signal!.aborted).toBe(false);
    expect(fileSystem.deletedFiles).toEqual([wavPath, `${base}.txt`]);
  });

  it('should derive the model file from STT_MODEL', async () => {
    settings.set('STT_MODEL', 'large-v3-turbo-q5_0');

    await adapter.transcribe('/tmp/a.mp3');

    expect(runs[1]!.args).toEqual(expect.arrayContaining(['-m', '/data/models/ggml-large-v3-turbo-q5_0.bin']));
  });

  it('should honor the settings and the language option', async () => {
    settings.set('STT_FFMPEG_BIN', '/opt/ffmpeg');
    settings.set('STT_WHISPER_BIN', '/opt/whisper');
    settings.set('STT_MODEL_PATH', '/models/large.bin');
    settings.set('STT_LANGUAGE', 'pt');
    settings.set('STT_THREADS', 3);
    settings.set('STT_TIMEOUT_MS', 1000);

    await adapter.transcribe('/tmp/a.mp3');
    await adapter.transcribe('/tmp/a.mp3', { language: 'en' });

    expect(runs[0]!.command).toBe('/opt/ffmpeg');
    expect(runs[1]!.command).toBe('/opt/whisper');
    expect(runs[1]!.args).toEqual(expect.arrayContaining(['-m', '/models/large.bin', '-l', 'pt', '-t', '3']));
    expect(runs[3]!.args).toEqual(expect.arrayContaining(['-l', 'en']));
  });

  it('should return an empty text when whisper writes no transcript', async () => {
    fileSystem.text = null;

    await expect(adapter.transcribe('/tmp/a.mp3')).resolves.toBe('');
  });

  it('should fail with the tail of the output and still clean up when a command exits non-zero', async () => {
    results = [{ exitCode: 1, output: ` ${'x'.repeat(600)}Invalid data ` }];

    const error = await adapter.transcribe('/tmp/a.mp3').catch((caught: Error) => caught);

    expect((error as Error).message).toMatch(/^ffmpeg failed \(exit 1\): x+Invalid data$/);
    expect((error as Error).message.length).toBeLessThan(560);
    expect(runs).toHaveLength(1);
    expect(fileSystem.deletedFiles).toHaveLength(2);
  });
});
