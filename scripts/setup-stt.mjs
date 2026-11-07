import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

try {
  process.loadEnvFile(envPath);
} catch {
  // .env is optional
}

const platform = process.platform;
const isWindows = platform === 'win32';
const dataDir = resolve(root, process.env.DATA_DIR?.trim() || 'data');
const binDir = join(dataDir, 'bin');
const model = process.env.STT_MODEL?.trim() || 'small';
const modelPath = process.env.STT_MODEL_PATH?.trim() || join(dataDir, 'models', `ggml-${model}.bin`);
const exe = (name) => (isWindows ? `${name}.exe` : name);

function has(command) {
  return spawnSync(isWindows ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? result.error?.message})`);
  }
}

function setEnv(key, value) {
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync(envPath, next);
  console.log(`[setup-stt] .env: ${line}`);
}

async function download(url, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, destination);
}

function findFile(directory, fileName) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, fileName);
      if (found) return found;
    } else if (entry.name === fileName) {
      return path;
    }
  }
  return undefined;
}

function installFfmpeg() {
  if (process.env.STT_FFMPEG_BIN?.trim() || has('ffmpeg')) return;
  console.log('[setup-stt] Installing ffmpeg');
  if (platform === 'darwin') {
    run('brew', ['install', 'ffmpeg']);
  } else if (isWindows) {
    run('winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements']);
    console.warn('[setup-stt] Open a new terminal so the ffmpeg PATH entry takes effect.');
  } else {
    throw new Error('ffmpeg is missing. Install it with your package manager (e.g. `sudo apt install ffmpeg`) and run this script again.');
  }
}

function installWhisperMac() {
  if (!has('brew')) throw new Error('Homebrew is required: https://brew.sh');
  if (!has('whisper-cli')) run('brew', ['install', 'whisper-cpp']);
}

function installWhisperLinux() {
  for (const tool of ['git', 'cmake', 'c++']) {
    if (!has(tool)) {
      throw new Error(`"${tool}" is required to build whisper.cpp (e.g. \`sudo apt install build-essential cmake git\`).`);
    }
  }
  const source = join(dataDir, 'whisper.cpp');
  if (!existsSync(source)) run('git', ['clone', '--depth', '1', 'https://github.com/ggml-org/whisper.cpp', source]);
  run('cmake', ['-B', 'build', '-DBUILD_SHARED_LIBS=OFF', '-DCMAKE_BUILD_TYPE=Release'], { cwd: source });
  run('cmake', ['--build', 'build', '-j', '--config', 'Release'], { cwd: source });
  const built = findFile(join(source, 'build', 'bin'), 'whisper-cli');
  if (!built) throw new Error('whisper-cli was not produced by the build');
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, 'whisper-cli');
  run('cp', [built, target]);
  setEnv('STT_WHISPER_BIN', target);
}

async function installWhisperWindows() {
  const release = await (await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', {
    headers: { 'User-Agent': 'agent-remote-control-setup' },
  })).json();
  const asset = release.assets?.find((candidate) => candidate.name === 'whisper-bin-x64.zip');
  if (!asset) throw new Error('whisper-bin-x64.zip was not found in the latest whisper.cpp release');
  const extractDir = join(binDir, 'whisper-cpp');
  const archive = join(binDir, asset.name);
  await download(asset.browser_download_url, archive);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run('tar', ['-xf', archive, '-C', extractDir]);
  rmSync(archive, { force: true });
  const binary = findFile(extractDir, 'whisper-cli.exe');
  if (!binary) throw new Error('whisper-cli.exe was not found in the downloaded archive');
  setEnv('STT_WHISPER_BIN', binary);
}

async function installModel() {
  if (existsSync(modelPath)) {
    console.log(`[setup-stt] Model already present: ${modelPath}`);
    return;
  }
  console.log(`[setup-stt] Downloading model '${model}' to ${modelPath}`);
  await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`, modelPath);
}

async function main() {
  installFfmpeg();

  const configuredBin = process.env.STT_WHISPER_BIN?.trim();
  if (configuredBin && existsSync(configuredBin)) {
    console.log(`[setup-stt] whisper-cli already configured: ${configuredBin}`);
  } else if (!configuredBin && has('whisper-cli')) {
    console.log('[setup-stt] whisper-cli already on the PATH');
  } else if (platform === 'darwin') {
    installWhisperMac();
  } else if (isWindows) {
    await installWhisperWindows();
  } else {
    installWhisperLinux();
  }

  await installModel();
  console.log('[setup-stt] Done. Restart `pnpm dev` to load the new environment.');
}

main().catch((error) => {
  console.error(`[setup-stt] ${error.message}`);
  process.exit(1);
});
