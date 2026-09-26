import type { AgentContext } from '@agentclientprotocol/sdk';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgyBridgeServer, runAgyBridge } from './agy-acp-bridge.js';


type MockProc = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

let lastSpawnedProc: MockProc | null = null;
const mockSpawn = vi.fn();
const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockAcpAgent = vi.fn();
vi.mock('@agentclientprotocol/sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@agentclientprotocol/sdk',
  );
  return {
    ...actual,
    agent: (options: unknown) => mockAcpAgent(options),
  };
});

function createMockChildProcess(): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

function createMockClientContext(): AgentContext {
  return {
    notify: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentContext;
}

describe('AgyBridgeServer', () => {
  const originalAgyPath = process.env.AGY_PATH;

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.AGY_PATH;
    lastSpawnedProc = null;
    mockSpawn.mockImplementation(() => {
      const proc = createMockChildProcess();
      lastSpawnedProc = proc;
      return proc;
    });
    mockExecFile.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _opts: unknown,
        callback: (err: null, stdout: string) => void,
      ) => {
        callback(
          null,
          'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n',
        );
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (originalAgyPath !== undefined) {
      process.env.AGY_PATH = originalAgyPath;
    } else {
      delete process.env.AGY_PATH;
    }
  });

  describe('initialize', () => {
    it('should return server capabilities and agent info', async () => {
      const server = new AgyBridgeServer();

      const response = await server.initialize();

      expect(response).toEqual({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, embeddedContext: false },
          sessionCapabilities: { close: {} },
        },
        agentInfo: {
          name: 'agy-acp-bridge',
          title: 'Google Antigravity (AGY)',
          version: '1.0.0',
        },
      });
    });
  });

  describe('loadSession', () => {
    it('should resume the agy conversation and adopt the requested session id', async () => {
      const server = new AgyBridgeServer();

      const loadPromise = server.loadSession({
        cwd: '/test/cwd',
        sessionId: 'conv-previous',
      });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-previous","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await loadPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'agy',
        expect.arrayContaining(['--conversation', 'conv-previous']),
        expect.objectContaining({ cwd: '/test/cwd' }),
      );
      expect(response.configOptions[0]).toEqual(
        expect.objectContaining({ id: 'model', currentValue: 'gemini-3.8-flash-low' }),
      );

      const client = createMockClientContext();
      const promptPromise = server.prompt(
        { sessionId: 'conv-previous', prompt: [{ type: 'text', text: 'hi' }] },
        client,
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-previous","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"hello"}}\n',
        ),
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-previous","status":"SUCCESS","response":"hello","num_turns":1,"usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n',
        ),
      );
      await promptPromise;

      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({ sessionId: 'conv-previous' }),
      );
    });

    it('should reject and stop agy when it resumes a different conversation', async () => {
      const server = new AgyBridgeServer();

      const loadPromise = server.loadSession({
        cwd: '/test/cwd',
        sessionId: 'conv-previous',
      });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-fresh","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );

      await expect(loadPromise).rejects.toThrow(
        'AGY resumed a different conversation (requested=conv-previous, got=conv-fresh)',
      );
      expect(lastSpawnedProc?.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should propagate agy startup failures', async () => {
      const server = new AgyBridgeServer();

      const loadPromise = server.loadSession({
        cwd: '/test/cwd',
        sessionId: 'conv-missing',
      });
      const rejection = expect(loadPromise).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(15_000);

      await rejection;
    });
  });

  describe('newSession', () => {
    it('should spawn agy with stream-json flags, discover models and wait for init event', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'agy',
        [
          '--output-format',
          'stream-json',
          '--input-format',
          'stream-json',
          '--dangerously-skip-permissions',
          '--print=',
          '--print-timeout',
          '8760h',
          '--add-dir',
          '/test/cwd',
        ],
        expect.objectContaining({
          cwd: '/test/cwd',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );

      const response = await sessionPromise;

      expect(response.sessionId).toBe('conv-123');
      expect(response.configOptions).toHaveLength(1);
      expect(response.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [
          { value: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
          { value: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
        ],
      });
    });

    it('should return empty options when agy models returns empty or fails', async () => {
      mockExecFile.mockImplementationOnce(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          callback: (err: Error) => void,
        ) => {
          callback(new Error('execFile failed'));
        },
      );
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await sessionPromise;

      expect(response.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [],
      });
    });

    it('should parse models when line has no tab, ignore empty lines and reuse discoveredModels', async () => {
      mockExecFile.mockImplementationOnce(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          callback: (err: null, stdout: string) => void,
        ) => {
          callback(null, '\n  \nonly-model-id\ncustom-id\tCustom Name\n');
        },
      );
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await sessionPromise;

      expect(response.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [
          { value: 'only-model-id', name: 'only-model-id' },
          { value: 'custom-id', name: 'Custom Name' },
        ],
      });

      const secondPromise = server.newSession({ cwd: '/test/cwd2' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-456","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd2","tools":[]}}\n',
        ),
      );
      const secondResponse = await secondPromise;
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      expect(secondResponse.configOptions).toEqual(response.configOptions);
    });

    it('should retry loading models on next session when previous attempt returned empty or failed', async () => {
      mockExecFile.mockImplementationOnce(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          callback: (err: Error) => void,
        ) => {
          callback(new Error('transient failure'));
        },
      );
      const server = new AgyBridgeServer();

      const firstPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-1","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const firstResponse = await firstPromise;
      expect(firstResponse.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [],
      });

      const secondPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-2","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const secondResponse = await secondPromise;
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(secondResponse.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [
          { value: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
          { value: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
        ],
      });
    });

    it('should resolve init event when emitted across multiple chunks in stdout', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit('data', Buffer.from('{"event":"in'));
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          'it","conversation_id":"conv-split-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );

      const response = await sessionPromise;
      expect(response.sessionId).toBe('conv-split-123');
    });

    it('should use AGY_PATH when set in environment', async () => {
      process.env.AGY_PATH = '/custom/bin/agy';
      const server = new AgyBridgeServer();
      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      expect(mockSpawn).toHaveBeenCalledWith(
        '/custom/bin/agy',
        expect.any(Array),
        expect.any(Object),
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;
    });

    it('should return empty options when stdout contains only whitespace or blank lines', async () => {
      mockExecFile.mockImplementationOnce(
        (
          _bin: string,
          _args: string[],
          _opts: unknown,
          callback: (err: null, stdout: string) => void,
        ) => {
          callback(null, '   \n\n  \n');
        },
      );
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await sessionPromise;

      expect(response.configOptions[0]).toEqual({
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'gemini-3.8-flash-low',
        options: [],
      });
    });

    it('should ignore data chunks with broken json before init event', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from('chunk with "event":"init" but broken\n'),
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from('{"event":"other","not_init":true,"event_str":"init"}\n'),
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-ok","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );

      const response = await sessionPromise;
      expect(response.sessionId).toBe('conv-ok');
    });

    it('should kill existing process when a new session is requested', async () => {
      const server = new AgyBridgeServer();

      const firstSessionPromise = server.newSession({ cwd: '/first' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-1","init":{"model":"gemini-3.8-flash-low","cwd":"/first","tools":[]}}\n',
        ),
      );
      await firstSessionPromise;
      const firstProc = lastSpawnedProc;

      const secondSessionPromise = server.newSession({ cwd: '/second' });
      expect(firstProc?.kill).toHaveBeenCalledWith('SIGTERM');

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-2","init":{"model":"gemini-3.8-flash-low","cwd":"/second","tools":[]}}\n',
        ),
      );
      const response = await secondSessionPromise;

      expect(response.sessionId).toBe('conv-2');
    });

    it('should reject when init event times out', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      const runningProc = lastSpawnedProc;
      const expectation = expect(sessionPromise).rejects.toThrow(
        'Timeout waiting for AGY init event',
      );

      await vi.advanceTimersByTimeAsync(15_000);

      await expectation;
      expect(runningProc?.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should reject when agy process emits an error during startup', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      const runningProc = lastSpawnedProc;
      lastSpawnedProc?.emit('error', new Error('spawn ENOENT'));

      await expect(sessionPromise).rejects.toThrow('spawn ENOENT');
      expect(runningProc?.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should reject when agy process exits prematurely before init event', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.emit('exit', 1, null);

      await expect(sessionPromise).rejects.toThrow(
        'AGY process exited prematurely (code=1, signal=null)',
      );
    });

    it('should fail if stdout stream is missing from spawned process', async () => {
      mockSpawn.mockReturnValueOnce({
        stdin: new PassThrough(),
        stdout: null,
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      const server = new AgyBridgeServer();

      await expect(server.newSession({ cwd: '/test/cwd' })).rejects.toThrow(
        'Failed to open stdio streams for AGY process',
      );
    });
  });

  describe('prompt and streaming updates', () => {
    it('should throw if prompt is called when process is not running', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      await expect(
        server.prompt(
          { sessionId: 's1', prompt: [{ type: 'text', text: 'hello' }] },
          client,
        ),
      ).rejects.toThrow('AGY process is not running');
    });

    it('should reject prompt if process exits prematurely while waiting for prompt', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task' }] },
        client,
      );

      lastSpawnedProc?.emit('exit', 1, 'SIGTERM');
      await expect(promptPromise).rejects.toThrow(
        'AGY process exited prematurely (code=1, signal=SIGTERM)',
      );
    });

    it('should throw if another prompt is already in progress', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      void server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'first' }] },
        client,
      );

      await expect(
        server.prompt(
          { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'second' }] },
          client,
        ),
      ).rejects.toThrow('Another prompt is already in progress');
    });

    it('should send user message NDJSON and stream step updates', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      let stdinWritten = '';
      lastSpawnedProc?.stdin.on('data', (chunk) => {
        stdinWritten += chunk.toString('utf8');
      });

      const promptPromise = server.prompt(
        {
          sessionId: 'conv-123',
          prompt: [{ type: 'text', text: 'Explain ACP' }],
        },
        client,
      );

      expect(JSON.parse(stdinWritten)).toEqual({
        event: 'user',
        message: { content: 'Explain ACP' },
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"ACP stands for"}}\n',
        ),
      );

      expect(client.notify).toHaveBeenCalledWith('session/update', {
        sessionId: 'conv-123',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'ACP stands for' },
        },
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"read_file"}}\n',
        ),
      );

      expect(client.notify).toHaveBeenCalledWith('session/update', {
        sessionId: 'conv-123',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'step_2',
          title: 'read_file',
          status: 'in_progress',
        },
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"DONE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{},"output":"file content"}}}\n',
        ),
      );

      expect(client.notify).toHaveBeenCalledWith('session/update', {
        sessionId: 'conv-123',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'step_2',
          title: 'read_file',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'file content' },
            },
          ],
        },
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"ERROR","step_type":"tool","tool_name":"run_cmd","tool_info":{"name":"run_cmd","parameters":{},"error":{"type":"ExecError","message":"command failed"}}}}\n',
        ),
      );

      expect(client.notify).toHaveBeenCalledWith('session/update', {
        sessionId: 'conv-123',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'step_3',
          title: 'run_cmd',
          status: 'failed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'command failed' },
            },
          ],
        },
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done","num_turns":1,"usage":{"input_tokens":100,"output_tokens":50,"thinking_tokens":10,"cache_read_tokens":5,"total_tokens":165}}}\n',
        ),
      );

      const result = await promptPromise;

      expect(result).toEqual({
        stopReason: 'end_turn',
        usage: {
          totalTokens: 165,
          inputTokens: 100,
          outputTokens: 50,
          thoughtTokens: 10,
          cachedReadTokens: 5,
        },
      });
    });

    it('should ignore non-JSON or unrelated lines without throwing', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit('data', Buffer.from('non-json line\n'));
      lastSpawnedProc?.stdout.emit('data', Buffer.from('{ broken json\n'));
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Test' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit('data', Buffer.from('plain logging text\n'));
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done","num_turns":1,"usage":{"input_tokens":10,"output_tokens":5,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":15}}}\n',
        ),
      );

      const result = await promptPromise;
      expect(result.stopReason).toBe('end_turn');
    });

    it('should reject prompt when result event indicates ERROR without response', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Boom' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},"error":"Model quota exceeded"}}\n',
        ),
      );

      await expect(promptPromise).rejects.toThrow('Model quota exceeded');
    });

    it('should reject prompt when result reports SUCCESS with no response and no token usage', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        {
          sessionId: 'conv-123',
          prompt: [{ type: 'text', text: 'Long round' }],
        },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"","num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}\n',
        ),
      );

      await expect(promptPromise).rejects.toThrow(
        'AGY abandoned the turn without producing a response',
      );
    });

    it('should reject prompt when result event indicates ERROR without error message', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","num_turns":0}}\n',
        ),
      );

      await expect(promptPromise).rejects.toThrow('AGY execution failed');
    });

    it('should handle tool calls with missing tool_name, output and error message', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        {
          sessionId: 'conv-123',
          prompt: [{ type: 'text', text: 'test tools' }],
        },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"ACTIVE","step_type":"tool"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({ title: 'tool' }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"DONE","step_type":"tool"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({ content: undefined }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"ERROR","step_type":"tool"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({ content: undefined }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done","num_turns":1}}\n',
        ),
      );

      const result = await promptPromise;
      expect(result.usage?.totalTokens).toBe(0);

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done2","num_turns":2}}\n',
        ),
      );
    });

    it('should ignore step_update when activeClientContext is null', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"early"}}\n',
        ),
      );
    });

    it('should ignore stdin error without crashing the server', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      expect(() => {
        lastSpawnedProc?.stdin.emit('error', new Error('EPIPE'));
      }).not.toThrow();

      await expect(server.closeSession()).resolves.toEqual({});
    });

    it('should not throw when cancel is called without running process', () => {
      const server = new AgyBridgeServer();
      expect(() => server.cancel()).not.toThrow();
    });

    it('should pipe stderr data to process.stderr', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stderr.emit('data', Buffer.from('warning message'));
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      expect(stderrSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
    });
  });

  describe('tool title formatting', () => {
    it('should format file and directory tools with relative or home paths', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      void server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'test' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/test/cwd/src/index.ts"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View src/index.ts',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View file',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":21,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/test/cwd/src/index.ts","StartLine":10,"EndLine":25}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View src/index.ts lines 10-25',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":22,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/test/cwd/src/index.ts","StartLine":10}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View src/index.ts from line 10',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/test/cwd"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'List .',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/test/cwd/src"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'List src',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":5,"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"/test/cwd/file.txt"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Write file.txt',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":6,"state":"ACTIVE","step_type":"tool","tool_name":"replace_file_content","tool_info":{"name":"replace_file_content","parameters":{"TargetFile":"/test/cwd/file.txt"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Edit file.txt',
          }),
        }),
      );
    });

    it('should format commands, searches, web tools and subagents', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      void server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'test' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"git status"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Run git status',
          }),
        }),
      );

      const longCmd = 'a'.repeat(70);
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          `{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"${longCmd}"}}}}\n`,
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: `Run ${'a'.repeat(59)}…`,
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":23,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Run command',
          }),
        }),
      );

      const home = homedir();
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          `{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":24,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"${home}"}}}}\n`,
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View ~',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          `{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":25,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"${home}/file.txt"}}}}\n`,
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View ~/file.txt',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":26,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"relative/file.txt"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'View relative/file.txt',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"grep_search","tool_info":{"name":"grep_search","parameters":{"Query":"pattern"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Grep "pattern"',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":31,"state":"ACTIVE","step_type":"tool","tool_name":"grep_search","tool_info":{"name":"grep_search","parameters":{"Query":"pattern","SearchPath":"/test/cwd/src"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Grep "pattern" in src',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"find_by_name","tool_info":{"name":"find_by_name","parameters":{"Pattern":"*.ts"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Find "*.ts"',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":41,"state":"ACTIVE","step_type":"tool","tool_name":"find_by_name","tool_info":{"name":"find_by_name","parameters":{"Pattern":"*.ts","SearchDirectory":"/test/cwd/src"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Find "*.ts" in src',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":5,"state":"ACTIVE","step_type":"tool","tool_name":"search_web","tool_info":{"name":"search_web","parameters":{"query":"test"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Search "test"',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":6,"state":"ACTIVE","step_type":"tool","tool_name":"read_url_content","tool_info":{"name":"read_url_content","parameters":{"Url":"https://example.com"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Read https://example.com',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":7,"state":"ACTIVE","step_type":"tool","tool_name":"open_browser_url","tool_info":{"name":"open_browser_url","parameters":{"Url":"https://example.com"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Open https://example.com',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":8,"state":"ACTIVE","step_type":"tool","tool_name":"command_status","tool_info":{"name":"command_status","parameters":{"TaskId":"task-1"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Check task task-1',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":81,"state":"ACTIVE","step_type":"tool","tool_name":"ask_question","tool_info":{"name":"ask_question","parameters":{"questions":[{"question":"Which database?"}]}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Question: Which database?',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":82,"state":"ACTIVE","step_type":"tool","tool_name":"ask_question"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Ask question',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":83,"state":"ACTIVE","step_type":"tool","tool_name":"manage_task","tool_info":{"name":"manage_task","parameters":{"Action":"kill","TaskId":"task-123"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Task kill task-123',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":84,"state":"ACTIVE","step_type":"tool","tool_name":"manage_task","tool_info":{"name":"manage_task","parameters":{"Action":"list"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Task list',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":85,"state":"ACTIVE","step_type":"tool","tool_name":"manage_task"}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Manage task',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":9,"state":"ACTIVE","step_type":"tool","tool_name":"invoke_subagent","tool_info":{"name":"invoke_subagent","parameters":{"Subagents":[{"Role":"Code Reviewer"}]}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Subagent: Code Reviewer',
          }),
        }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":10,"state":"ACTIVE","step_type":"tool","tool_name":"custom_tool","tool_info":{"name":"custom_tool","parameters":{"toolAction":"Custom Action"}}}}\n',
        ),
      );
      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            title: 'Custom Action',
          }),
        }),
      );
    });
  });

  describe('setConfigOption', () => {
    it('should update selected model and restart process when idle', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;
      const initialProc = lastSpawnedProc;

      const configPromise = server.setConfigOption({
        sessionId: 'conv-123',
        configId: 'model',
        value: 'claude-sonnet-4-6',
      });

      expect(initialProc?.kill).toHaveBeenCalledWith('SIGTERM');

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"claude-sonnet-4-6","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await configPromise;

      const modelOption = response.configOptions.find(
        opt => opt.id === 'model',
      );
      expect(modelOption?.currentValue).toBe('claude-sonnet-4-6');
    });

    it('should apply first model option when selectedModel was null and differs from activeModel', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const session = await sessionPromise;
      expect(session.configOptions[0]?.currentValue).toBe(
        'gemini-3.8-flash-low',
      );

      const initialProc = lastSpawnedProc;
      const configPromise = server.setConfigOption({
        sessionId: 'conv-123',
        configId: 'model',
        value: 'gemini-3.8-flash-high',
      });

      expect(initialProc?.kill).toHaveBeenCalledWith('SIGTERM');
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-high","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const response = await configPromise;
      const modelOption = response.configOptions.find(
        opt => opt.id === 'model',
      );
      expect(modelOption?.currentValue).toBe('gemini-3.8-flash-high');
    });

    it('should not restart process when model option is unchanged', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const firstConfigPromise = server.setConfigOption({
        sessionId: 'conv-123',
        configId: 'model',
        value: 'gemini-3.8-flash-low',
      });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await firstConfigPromise;

      const runningProc = lastSpawnedProc;

      const response = await server.setConfigOption({
        sessionId: 'conv-123',
        configId: 'model',
        value: 'gemini-3.8-flash-low',
      });

      expect(runningProc?.kill).not.toHaveBeenCalled();
      const modelOption = response.configOptions.find(
        opt => opt.id === 'model',
      );
      expect(modelOption?.currentValue).toBe('gemini-3.8-flash-low');
    });

    it('should preserve original sessionId when restarted process emits divergent conversation_id', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-original","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      const session = await sessionPromise;
      expect(session.sessionId).toBe('conv-original');

      const configPromise = server.setConfigOption({
        sessionId: 'conv-original',
        configId: 'model',
        value: 'claude-sonnet-4-6',
      });

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-divergent","init":{"model":"claude-sonnet-4-6","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await configPromise;

      const client = createMockClientContext();
      const promptPromise = server.prompt(
        {
          sessionId: 'conv-original',
          prompt: [{ type: 'text', text: 'Hello' }],
        },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"conversation_id":"conv-divergent","step_index":0,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hi"}}\n',
        ),
      );

      expect(client.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sessionId: 'conv-original' }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-divergent","status":"COMPLETED","response":"Hi","num_turns":1,"usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n',
        ),
      );
      await promptPromise;
    });
  });

  describe('concurrent prompt rejection', () => {
    it('should reject prompt when AGY process is not running and cwd is missing', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      await expect(
        server.prompt(
          { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'prompt' }] },
          client,
        ),
      ).rejects.toThrow('AGY process is not running');
    });
  });

  describe('cancel', () => {
    it('should kill agy process with SIGINT and resolve prompt with stopReason cancelled', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        {
          sessionId: 'conv-123',
          prompt: [{ type: 'text', text: 'Long task' }],
        },
        client,
      );

      server.cancel();

      expect(lastSpawnedProc?.kill).toHaveBeenCalledWith('SIGINT');

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Interrupted","num_turns":1,"usage":{"input_tokens":5,"output_tokens":2,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":7}}}\n',
        ),
      );

      const result = await promptPromise;
      expect(result.stopReason).toBe('cancelled');
    });

    it('should resolve prompt with stopReason cancelled when result indicates error interrupted', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        {
          sessionId: 'conv-123',
          prompt: [{ type: 'text', text: 'Long task' }],
        },
        client,
      );

      server.cancel();

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","error":"interrupted","num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}\n',
        ),
      );

      const result = await promptPromise;
      expect(result.stopReason).toBe('cancelled');
    });

    it('should restart agy with --conversation on next prompt after process exits on cancel', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task 1' }] },
        client,
      );

      server.cancel();
      const firstProc = lastSpawnedProc;

      firstProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","error":"interrupted","num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}\n',
        ),
      );
      await promptPromise;

      firstProc?.emit('exit', 1, null);

      const nextPromptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task 2' }] },
        client,
      );

      expect(mockSpawn).toHaveBeenLastCalledWith(
        'agy',
        expect.arrayContaining(['--conversation', 'conv-123']),
        expect.objectContaining({ cwd: '/test/cwd' }),
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );

      let stdinWritten = '';
      lastSpawnedProc?.stdin.on('data', (chunk) => {
        stdinWritten += chunk.toString('utf8');
      });
      await vi.waitFor(() => expect(stdinWritten).not.toBe(''));

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done 2","num_turns":1,"usage":{"input_tokens":10,"output_tokens":5,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":15}}}\n',
        ),
      );

      const nextResult = await nextPromptPromise;
      expect(nextResult.stopReason).toBe('end_turn');
      expect(JSON.parse(stdinWritten)).toEqual({
        event: 'user',
        message: { content: 'Task 2' },
      });
    });

    it('should run the next prompt on a new process when the interrupted one has not exited yet', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();
      const init = '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n';

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit('data', Buffer.from(init));
      await sessionPromise;
      const interruptedProc = lastSpawnedProc;

      const firstPrompt = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task 1' }] },
        client,
      );
      server.cancel();
      interruptedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","error":"interrupted","num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}\n',
        ),
      );
      await expect(firstPrompt).resolves.toMatchObject({ stopReason: 'cancelled' });

      let interruptedStdin = '';
      interruptedProc?.stdin.on('data', (chunk) => {
        interruptedStdin += chunk.toString('utf8');
      });

      const nextPrompt = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task 2' }] },
        client,
      );
      const restartedProc = lastSpawnedProc;
      expect(restartedProc).not.toBe(interruptedProc);
      expect(interruptedProc?.kill).toHaveBeenLastCalledWith('SIGTERM');
      expect(mockSpawn).toHaveBeenLastCalledWith(
        'agy',
        expect.arrayContaining(['--conversation', 'conv-123']),
        expect.objectContaining({ cwd: '/test/cwd' }),
      );
      let restartedStdin = '';
      restartedProc?.stdin.on('data', (chunk) => {
        restartedStdin += chunk.toString('utf8');
      });
      restartedProc?.stdout.emit('data', Buffer.from(init));
      await vi.waitFor(() => expect(restartedStdin).not.toBe(''));

      interruptedProc?.emit('exit', null, 'SIGINT');
      interruptedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"ERROR","response":"","error":"interrupted","num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}\n',
        ),
      );
      restartedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Done 2","num_turns":1,"usage":{"input_tokens":10,"output_tokens":5,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":15}}}\n',
        ),
      );

      await expect(nextPrompt).resolves.toMatchObject({ stopReason: 'end_turn' });
      expect(JSON.parse(restartedStdin)).toEqual({ event: 'user', message: { content: 'Task 2' } });
      expect(interruptedStdin).not.toContain('Task 2');
    });

    it('should resolve cancellation when process exits with SIGINT before result event', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Task 1' }] },
        client,
      );

      server.cancel();
      lastSpawnedProc?.emit('exit', 1, 'SIGINT');

      const result = await promptPromise;
      expect(result.stopReason).toBe('cancelled');
    });
  });

  describe('closeSession', () => {
    it('should terminate the agy process with SIGTERM and clear session state', async () => {
      const server = new AgyBridgeServer();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;
      const proc = lastSpawnedProc;

      const result = await server.closeSession();

      expect(proc?.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toEqual({});
    });

    it('should reject active prompt when closeSession is called while prompt is running', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();

      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'conv-123', prompt: [{ type: 'text', text: 'Waiting' }] },
        client,
      );

      void server.closeSession();

      await expect(promptPromise).rejects.toThrow('AGY process was terminated');
    });
  });

  describe('runAgyBridge', () => {
    it('should wire stdio streams and connect acpAgent, invoking registered handlers', async () => {
      const requestHandlers = new Map<
        string,
        (ctx: Record<string, unknown>) => unknown
      >();
      const notificationHandlers = new Map<
        string,
        (ctx: Record<string, unknown>) => unknown
      >();

      const builder = {
        onRequest: vi.fn((...args: unknown[]) => {
          const method = args[0] as string;
          const handler = (args.length === 3 ? args[2] : args[1]) as (
            ctx: Record<string, unknown>,
          ) => unknown;
          requestHandlers.set(method, handler);
          return builder;
        }),
        onNotification: vi.fn(
          (
            method: string,
            handler: (ctx: Record<string, unknown>) => unknown,
          ) => {
            notificationHandlers.set(method, handler);
            return builder;
          },
        ),
        connect: vi.fn(),
      };
      mockAcpAgent.mockReturnValue(builder);

      runAgyBridge();

      expect(mockAcpAgent).toHaveBeenCalledWith({ name: 'agy-acp-bridge' });
      expect(builder.connect).toHaveBeenCalled();

      const initHandler = requestHandlers.get('initialize');
      if (initHandler) {
        const res = (await initHandler({})) as { protocolVersion: number };
        expect(res.protocolVersion).toBe(1);
      }

      const newHandler = requestHandlers.get('session/new');
      if (newHandler) {
        const promise = newHandler({
          params: { cwd: '/test/cwd' },
        }) as Promise<{
          sessionId: string;
        }>;
        lastSpawnedProc?.stdout.emit(
          'data',
          Buffer.from(
            '{"event":"init","conversation_id":"conv-wired","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
          ),
        );
        const res = await promise;
        expect(res.sessionId).toBe('conv-wired');
      }

      const loadHandler = requestHandlers.get('session/load');
      if (loadHandler) {
        const promise = loadHandler({
          params: { cwd: '/test/cwd', sessionId: 'conv-wired' },
        }) as Promise<{ configOptions: unknown[] }>;
        lastSpawnedProc?.stdout.emit(
          'data',
          Buffer.from(
            '{"event":"init","conversation_id":"conv-wired","init":{"model":"gemini-3.8-flash-low","cwd":"/test/cwd","tools":[]}}\n',
          ),
        );
        const res = await promise;
        expect(res.configOptions).toBeDefined();
      }

      const setOptionHandler = requestHandlers.get('session/set_config_option');
      if (setOptionHandler) {
        const res = (await setOptionHandler({
          params: { sessionId: 'conv-wired', configId: 'unknown', value: '1' },
        })) as { configOptions: unknown[] };
        expect(res.configOptions).toBeDefined();
      }

      const promptHandler = requestHandlers.get('session/prompt');
      if (promptHandler) {
        const client = createMockClientContext();
        const promise = promptHandler({
          params: {
            sessionId: 'conv-wired',
            prompt: [{ type: 'text', text: 'hi' }],
          },
          client,
        }) as Promise<{ stopReason: string }>;
        lastSpawnedProc?.stdout.emit(
          'data',
          Buffer.from(
            '{"event":"result","result":{"conversation_id":"conv-wired","status":"SUCCESS","response":"hi","num_turns":1,"usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n',
          ),
        );
        const res = await promise;
        expect(res.stopReason).toBe('end_turn');
      }

      const cancelHandler = notificationHandlers.get('session/cancel');
      if (cancelHandler) {
        cancelHandler({});
      }

      const closeHandler = requestHandlers.get('session/close');
      if (closeHandler) {
        const res = await closeHandler({});
        expect(res).toEqual({});
      }
    });

    it('should terminate session and exit on SIGTERM or SIGINT', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const builder = {
        onRequest: vi.fn().mockReturnThis(),
        onNotification: vi.fn().mockReturnThis(),
        connect: vi.fn(),
      };
      mockAcpAgent.mockReturnValue(builder);

      runAgyBridge();

      const termListeners = process.listeners('SIGTERM');
      const lastTermListener = termListeners[termListeners.length - 1];
      expect(lastTermListener).toBeDefined();
      if (lastTermListener) {
        lastTermListener('SIGTERM');
        expect(exitSpy).toHaveBeenCalledWith(0);
      }

      const intListeners = process.listeners('SIGINT');
      const lastIntListener = intListeners[intListeners.length - 1];
      expect(lastIntListener).toBeDefined();
      if (lastIntListener) {
        lastIntListener('SIGINT');
        expect(exitSpy).toHaveBeenCalledWith(0);
      }

      exitSpy.mockRestore();
    });

    it('should throw if prompt is called when AGY process is not running', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();
      await expect(
        server.prompt(
          { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] },
          client,
        ),
      ).rejects.toThrow('AGY process is not running');
    });

    it('should return normalized path when file is outside cwd and outside home', async () => {
      const server = new AgyBridgeServer();
      const client = createMockClientContext();
      const sessionPromise = server.newSession({ cwd: '/test/cwd' });
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"init","conversation_id":"c1","init":{"model":"m","cwd":"/test/cwd","tools":[]}}\n',
        ),
      );
      await sessionPromise;

      const promptPromise = server.prompt(
        { sessionId: 'c1', prompt: [{ type: 'text', text: 'hi' }] },
        client,
      );

      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"step_update","step_update":{"step_type":"tool","step_index":1,"state":"ACTIVE","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/var/log/syslog"}}}}\n',
        ),
      );
      lastSpawnedProc?.stdout.emit(
        'data',
        Buffer.from(
          '{"event":"result","result":{"status":"SUCCESS","response":"ok"}}\n',
        ),
      );
      await promptPromise;

      expect(client.notify).toHaveBeenCalledWith(
        'session/update',
        expect.objectContaining({
          update: expect.objectContaining({
            title: expect.stringContaining('/var/log/syslog'),
          }),
        }),
      );
    });
  });
});
