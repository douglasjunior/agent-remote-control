import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional
}

const port = process.env.PORT || '3000';
const healthUrl = `http://localhost:${port}/health`;
const children = new Set();
let shuttingDown = false;

function start(name, args, { longRunning = true } = {}) {
  const child = spawn('pnpm', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) console.log(`[${name}] ${line}`);
    });
  }
  child.on('exit', (code) => {
    children.delete(child);
    if (longRunning && !shuttingDown) {
      console.error(`[dev] ${name} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  process.exit(code);
}

async function waitForServer() {
  while (!shuttingDown) {
    try {
      if ((await fetch(healthUrl)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const build = start('protocol', ['--filter', '@agent-remote-control/protocol', 'build'], { longRunning: false });
await new Promise((resolve) => build.on('exit', resolve));
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

start('protocol', ['--filter', '@agent-remote-control/protocol', 'dev']);
start('server', ['--filter', '@agent-remote-control/server', 'dev']);
await waitForServer();
start('web', ['--filter', '@agent-remote-control/web', 'dev']);
