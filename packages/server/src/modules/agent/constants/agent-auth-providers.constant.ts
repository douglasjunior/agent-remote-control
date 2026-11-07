import { CURSOR_BINARIES } from '../adapters/cursor.adapter.js';
import type { AgentAuthStatus } from '../models/agent-auth.model.js';


export type AgentStatusParse = {
  readonly status: AgentAuthStatus;
  readonly detail?: string;
};

type StatusProbe =
  | {
    readonly kind: 'command';
    readonly binaries: readonly string[];
    readonly args: readonly string[];
    readonly parse: (output: string, exitCode: number) => AgentStatusParse;
  }
  /** `session/new` through the agent's own ACP adapter: the CLI refuses it with an authentication error while logged out. */
  | { readonly kind: 'acp' };

export type AgentAuthProvider = {
  readonly agentId: string;
  readonly login: {
    readonly binaries: readonly string[];
    readonly args: readonly string[];
    /**
     * Needs a terminal: Copilot only asks whether to keep its token in a plain file when it has one. Without a
     * system keychain (WSL, containers) that file is the only place the token can go, so the answer is yes.
     */
    readonly terminal?: boolean;
    /** Line written when the CLI asks a yes or no question; without it the question goes to the user as a prompt. */
    readonly confirmAnswer?: string;
  };
  readonly status: StatusProbe;
};

function parseJsonObject(output: string): Record<string, unknown> | undefined {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseClaudeStatus(output: string): AgentStatusParse {
  const json = parseJsonObject(output);
  if (typeof json?.loggedIn !== 'boolean') {
    return { status: 'unknown' };
  }
  return json.loggedIn
    ? { status: 'authenticated', detail: asString(json.email) }
    : { status: 'unauthenticated' };
}

function parseCursorStatus(output: string): AgentStatusParse {
  const json = parseJsonObject(output);
  if (typeof json?.isAuthenticated !== 'boolean') {
    return { status: 'unknown' };
  }
  return json.isAuthenticated
    ? { status: 'authenticated', detail: asString(json.email) ?? asString(json.account) }
    : { status: 'unauthenticated' };
}

function parseCodexStatus(output: string, exitCode: number): AgentStatusParse {
  if (/not logged in/i.test(output)) {
    return { status: 'unauthenticated' };
  }
  return exitCode === 0 ? { status: 'authenticated' } : { status: 'unknown' };
}

/**
 * CLI logins that print a link (and a code) and finish without a browser on this machine. Each flow was
 * verified against the installed CLIs: Claude and Antigravity wait for a code pasted on stdin, Codex and
 * Copilot poll a device code, Cursor polls its own server.
 */
export const AGENT_AUTH_PROVIDERS: readonly AgentAuthProvider[] = [
  {
    agentId: 'agy',
    login: { binaries: ['agy'], args: ['acp', '--login'] },
    status: { kind: 'acp' },
  },
  {
    agentId: 'claude',
    login: { binaries: ['claude'], args: ['auth', 'login', '--claudeai'] },
    status: { kind: 'command', binaries: ['claude'], args: ['auth', 'status'], parse: parseClaudeStatus },
  },
  {
    agentId: 'copilot',
    login: { binaries: ['copilot'], args: ['login', '--device-code'], terminal: true, confirmAnswer: 'y' },
    status: { kind: 'acp' },
  },
  {
    agentId: 'codex',
    login: { binaries: ['codex'], args: ['login', '--device-auth'] },
    status: { kind: 'command', binaries: ['codex'], args: ['login', 'status'], parse: parseCodexStatus },
  },
  {
    agentId: 'cursor',
    login: { binaries: CURSOR_BINARIES, args: ['login'] },
    status: {
      kind: 'command',
      binaries: CURSOR_BINARIES,
      args: ['status', '--format', 'json'],
      parse: parseCursorStatus,
    },
  },
];
