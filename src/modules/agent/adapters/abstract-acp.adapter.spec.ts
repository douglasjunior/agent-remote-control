import { spawn, type ChildProcess } from 'node:child_process';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  effortConfigOption,
  messageChunk,
  modelConfigOption,
  permissionsConfigOption,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';
import {
  AbstractAcpAdapter,
  CANCEL_ABORT_PROMPT_TEXT,
  type AgentExtensionRequest,
  type SessionConfigPreset,
} from './abstract-acp.adapter.js';
import {
  PromptCancelledError,
  type AgentActivity,
  type AgentUpdate,
  type AgentUsage,
} from '../ports/agent.port.js';

vi.mock('node:child_process', async () =>
  (
    await import('../testing/acp-adapter-test-harness.js')
  ).childProcessMockModule(),
);
vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule(),
);
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule(),
);

class TestAcpAdapter extends AbstractAcpAdapter {
  protected readonly agentName = 'test';

  protected spawnAgentProcess(): ChildProcess {
    return spawn('test-agent', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

class PresetAcpAdapter extends AbstractAcpAdapter {
  protected readonly agentName = 'preset';

  protected spawnAgentProcess(): ChildProcess {
    return spawn('test-agent', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  protected override sessionConfigPresets(): readonly SessionConfigPreset[] {
    return [{ category: 'permissions', value: 'on' }];
  }
}

class ExtensionAcpAdapter extends AbstractAcpAdapter {
  protected readonly agentName = 'extension';

  protected spawnAgentProcess(): ChildProcess {
    return spawn('test-agent', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  protected override agentExtensionRequests(): readonly AgentExtensionRequest[] {
    return [
      {
        method: 'vendor/ask',
        parseParams: (params: unknown) => params,
        respond: () => ({ answered: true }),
      },
    ];
  }
}

class FallbackAcpAdapter extends AbstractAcpAdapter {
  protected readonly agentName = 'fallback';
  fallbackResult: AgentUsage | undefined = undefined;
  fallbackError: Error | undefined = undefined;
  readonly collectFallbackCalls: string[] = [];

  protected spawnAgentProcess(): ChildProcess {
    return spawn('test-agent', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  protected override async collectFallbackUsage(
    sessionId: string,
  ): Promise<AgentUsage | undefined> {
    this.collectFallbackCalls.push(sessionId);
    if (this.fallbackError) {
      throw this.fallbackError;
    }
    return this.fallbackResult;
  }
}

describe('AbstractAcpAdapter', () => {
  beforeEach(() => {
    resetAcpHarness();
    vi.mocked(spawn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('should spawn the agent process and initialize the connection', async () => {
      const adapter = new TestAcpAdapter();

      await adapter.connect();

      expect(acpHarness.spawnedProcs).toHaveLength(1);
      expect(acpHarness.connectionInstance?.initialize).toHaveBeenCalledWith({
        protocolVersion: 'mock-protocol-version',
        clientCapabilities: {},
      });
    });

    it('should be idempotent and not spawn a second process when already connected', async () => {
      const adapter = new TestAcpAdapter();

      await adapter.connect();
      await adapter.connect();

      expect(acpHarness.spawnedProcs).toHaveLength(1);
    });

    it('should run a discovery newSession and close it during connect()', async () => {
      const adapter = new TestAcpAdapter();

      await adapter.connect();

      expect(acpHarness.connectionInstance?.newSession).toHaveBeenCalledWith({
        cwd: expect.any(String),
        mcpServers: [],
      });
      expect(acpHarness.connectionInstance?.closeSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });
    });

    it('should cache configOptions returned by the discovery session', async () => {
      acpHarness.pendingConnectionOverrides = {
        newSession: vi.fn().mockResolvedValue({
          sessionId: 'discovery-session',
          configOptions: [
            modelConfigOption({
              currentValue: 'auto',
              options: [
                { value: 'auto', name: 'Auto' },
                { value: 'gpt-5', name: 'GPT-5', description: 'Smart' },
              ],
            }),
          ],
        }),
        closeSession: vi.fn().mockResolvedValue(undefined),
      };

      const adapter = new TestAcpAdapter();
      await adapter.connect();

      expect(adapter.getAvailableModels()).toEqual({
        availableModels: [
          {
            modelId: 'auto',
            name: 'Auto',
            displayName: 'Auto',
            description: undefined,
          },
          {
            modelId: 'gpt-5',
            name: 'GPT-5',
            displayName: 'GPT-5',
            description: 'Smart',
          },
        ],
        currentModelId: 'auto',
      });
    });

    it('should swallow errors during discovery without breaking connect()', async () => {
      const adapter = new TestAcpAdapter();
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      acpHarness.pendingConnectionOverrides = {
        newSession: vi.fn().mockRejectedValue(new Error('discovery failed')),
      };

      try {
        await expect(adapter.connect()).resolves.toBeUndefined();
        expect(adapter.getAvailableModels()).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'discover_config_options_failed: discovery failed',
          ),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should throw a transport error when the spawned process has no piped stdio streams', async () => {
      class NoStdioAdapter extends AbstractAcpAdapter {
        protected readonly agentName = 'test';

        protected spawnAgentProcess(): ChildProcess {
          return {
            stdin: null,
            stdout: null,
            stderr: null,
            kill: vi.fn(),
          } as unknown as ChildProcess;
        }
      }

      await expect(new NoStdioAdapter().connect()).rejects.toThrow(
        'Erro retornado pelo agente (test)',
      );
    });

    it('should log "Unknown error" when discovery fails with a non-Error value', async () => {
      const adapter = new TestAcpAdapter();
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      acpHarness.pendingConnectionOverrides = {
        newSession: vi.fn().mockRejectedValue('discovery string boom'),
      };

      try {
        await expect(adapter.connect()).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'discover_config_options_failed: Unknown error',
          ),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should not leave the discovery sessionId set as the current session', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await expect(async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      }).rejects.toThrow('No active session');
    });

    it('should detect steering support from initializeResponse', async () => {
      acpHarness.pendingConnectionOverrides = {
        initialize: vi.fn().mockResolvedValue({
          _meta: { steering: { supported: true } },
        }),
      };

      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.sendSteeringPrompt('steer here');

      expect(acpHarness.connectionInstance?.steer).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          prompt: [{ type: 'text', text: 'steer here' }],
        }),
      );
    });
  });

  describe('createSession', () => {
    it('should throw when called before connect()', async () => {
      const adapter = new TestAcpAdapter();

      await expect(adapter.createSession('/repo')).rejects.toThrow(
        'Not connected',
      );
    });

    it('should call connection.newSession with the provided cwd', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await adapter.createSession('/repo');

      expect(acpHarness.connectionInstance?.newSession).toHaveBeenCalledWith({
        cwd: '/repo',
        mcpServers: [],
      });
    });

    it('should cache configOptions returned by newSession and expose models via getAvailableModels', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [
              { value: 'auto', name: 'Auto' },
              { value: 'gpt-5', name: 'GPT-5', description: 'Smart model' },
            ],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()).toEqual({
        availableModels: [
          {
            modelId: 'auto',
            name: 'Auto',
            displayName: 'Auto',
            description: undefined,
          },
          {
            modelId: 'gpt-5',
            name: 'GPT-5',
            displayName: 'GPT-5',
            description: 'Smart model',
          },
        ],
        currentModelId: 'auto',
      });
    });

    it('should drop the description when it only repeats the model name (default mapModel)', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'opus',
            options: [
              {
                value: 'opus',
                name: 'Claude Opus 4.5',
                description: 'Claude Opus 4.5',
              },
              {
                value: 'auto',
                name: 'Auto',
                description: 'Let the agent pick',
              },
            ],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()).toEqual({
        availableModels: [
          {
            modelId: 'opus',
            name: 'Claude Opus 4.5',
            displayName: 'Claude Opus 4.5',
            description: undefined,
          },
          {
            modelId: 'auto',
            name: 'Auto',
            displayName: 'Auto',
            description: 'Let the agent pick',
          },
        ],
        currentModelId: 'opus',
      });
    });

    it('should return null from getAvailableModels when no model option is published', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()).toBeNull();
    });

    it('should flatten grouped model options into a single available models list', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          {
            id: 'model',
            type: 'select',
            name: 'Model',
            category: 'model',
            currentValue: 'a',
            options: [
              {
                name: 'Group',
                options: [
                  { value: 'a', name: 'A' },
                  { value: 'b', name: 'B' },
                ],
              },
            ],
          },
        ],
      });

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()).toEqual({
        availableModels: [
          { modelId: 'a', name: 'A', displayName: 'A', description: undefined },
          { modelId: 'b', name: 'B', displayName: 'B', description: undefined },
        ],
        currentModelId: 'a',
      });
    });

    it('should expose models when the select has an opaque id but classifies via category', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          {
            ...modelConfigOption({
              currentValue: 'gpt-5',
              options: [{ value: 'gpt-5', name: 'GPT-5' }],
            }),
            id: 'llm',
          },
        ],
      });

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()?.currentModelId).toBe('gpt-5');
    });

    it('should apply preferredConfig via setSessionConfigOption when set in constructor', async () => {
      const adapter = new TestAcpAdapter({ modelId: 'gpt-5' });
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [
              { value: 'auto', name: 'Auto' },
              { value: 'gpt-5', name: 'GPT-5' },
            ],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockResolvedValueOnce(
        {
          configOptions: [
            modelConfigOption({
              currentValue: 'gpt-5',
              options: [
                { value: 'auto', name: 'Auto' },
                { value: 'gpt-5', name: 'GPT-5' },
              ],
            }),
          ],
        },
      );

      await adapter.createSession('/repo');

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'model',
        value: 'gpt-5',
      });
      expect(adapter.getAvailableModels()?.currentModelId).toBe('gpt-5');
    });

    it('should NOT call setSessionConfigOption when preferred value matches currentValue', async () => {
      const adapter = new TestAcpAdapter({ modelId: 'auto' });
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [{ value: 'auto', name: 'Auto' }],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).not.toHaveBeenCalled();
    });

    it('should NOT call setSessionConfigOption when preferred value is not in available options', async () => {
      const adapter = new TestAcpAdapter({ modelId: 'nonexistent' });
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [{ value: 'auto', name: 'Auto' }],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).not.toHaveBeenCalled();
    });

    it('should not throw when setSessionConfigOption fails while applying preferredConfig', async () => {
      const adapter = new TestAcpAdapter({ modelId: 'gpt-5' });
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [
              { value: 'auto', name: 'Auto' },
              { value: 'gpt-5', name: 'GPT-5' },
            ],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockRejectedValueOnce(
        new Error('not supported'),
      );

      await expect(adapter.createSession('/repo')).resolves.toBeUndefined();
      expect(adapter.getAvailableModels()?.currentModelId).toBe('auto');
    });

    it('should apply the adapter session config presets on every new session', async () => {
      const adapter = new PresetAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          permissionsConfigOption({
            currentValue: 'off',
            options: [
              { value: 'on', name: 'On' },
              { value: 'off', name: 'Off' },
            ],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'allow_all',
        value: 'on',
      });
    });

    it('should skip a session config preset the agent does not publish', async () => {
      const adapter = new PresetAcpAdapter();
      await adapter.connect();

      await adapter.createSession('/repo');

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).not.toHaveBeenCalled();
    });

    it('should not throw when a session config preset fails to apply', async () => {
      const adapter = new PresetAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          permissionsConfigOption({
            currentValue: 'off',
            options: [
              { value: 'on', name: 'On' },
              { value: 'off', name: 'Off' },
            ],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockRejectedValueOnce(
        new Error('not supported'),
      );

      await expect(adapter.createSession('/repo')).resolves.toBeUndefined();
    });
  });

  describe('config_option_update', () => {
    it('should sync the cached config options when the agent pushes a config_option_update', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      expect(adapter.getAvailableModels()).toBeNull();

      await acpHarness.lastClient?.sessionUpdate({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'config_option_update',
          configOptions: [
            modelConfigOption({
              currentValue: 'opus',
              options: [
                { value: 'sonnet', name: 'Sonnet' },
                { value: 'opus', name: 'Opus' },
              ],
            }),
          ],
        },
      });

      expect(adapter.getAvailableModels()).toEqual({
        availableModels: [
          {
            modelId: 'sonnet',
            name: 'Sonnet',
            displayName: 'Sonnet',
            description: undefined,
          },
          {
            modelId: 'opus',
            name: 'Opus',
            displayName: 'Opus',
            description: undefined,
          },
        ],
        currentModelId: 'opus',
      });
    });

    it('should not touch the cached options for unrelated session updates', async () => {
      acpHarness.pendingConnectionOverrides = {
        newSession: vi.fn().mockResolvedValue({
          sessionId: 'discovery-session',
          configOptions: [
            modelConfigOption({
              currentValue: 'auto',
              options: [{ value: 'auto', name: 'Auto' }],
            }),
          ],
        }),
      };
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await acpHarness.lastClient?.sessionUpdate(
        messageChunk('narration', 'm1'),
      );

      expect(adapter.getAvailableModels()?.currentModelId).toBe('auto');
    });
  });

  describe('getAvailableEffortsForModel', () => {
    it('should return null when connect was not called', async () => {
      const adapter = new TestAcpAdapter();

      expect(await adapter.getAvailableEffortsForModel('gpt-5')).toBeNull();
    });

    it('should open a probe session, apply the model, read efforts, and close the session', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'probe-session',
        configOptions: [
          modelConfigOption({
            currentValue: 'sonnet-4.6',
            options: [
              { value: 'sonnet-4.6', name: 'Sonnet 4.6' },
              { value: 'opus-4.6', name: 'Opus 4.6' },
            ],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockResolvedValueOnce(
        {
          configOptions: [
            modelConfigOption({
              currentValue: 'opus-4.6',
              options: [
                { value: 'sonnet-4.6', name: 'Sonnet 4.6' },
                { value: 'opus-4.6', name: 'Opus 4.6' },
              ],
            }),
            effortConfigOption({
              currentValue: 'medium',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
              ],
            }),
          ],
        },
      );

      const result = await adapter.getAvailableEffortsForModel('opus-4.6');

      expect(result).toEqual({
        availableEfforts: [
          { effortId: 'low', name: 'Low', description: undefined },
          { effortId: 'medium', name: 'Medium', description: undefined },
          { effortId: 'high', name: 'High', description: undefined },
        ],
        currentEffortId: 'medium',
      });
      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledWith({
        sessionId: 'probe-session',
        configId: 'model',
        value: 'opus-4.6',
      });
      expect(acpHarness.connectionInstance?.closeSession).toHaveBeenCalledWith({
        sessionId: 'probe-session',
      });
    });

    it('should keep a distinct effort description and drop one that only repeats the name', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'probe-session',
        configOptions: [
          modelConfigOption({
            currentValue: 'sonnet',
            options: [
              { value: 'sonnet', name: 'Sonnet' },
              { value: 'opus', name: 'Opus' },
            ],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockResolvedValueOnce(
        {
          configOptions: [
            modelConfigOption({
              currentValue: 'opus',
              options: [
                { value: 'sonnet', name: 'Sonnet' },
                { value: 'opus', name: 'Opus' },
              ],
            }),
            effortConfigOption({
              currentValue: 'high',
              options: [
                {
                  value: 'high',
                  name: 'High',
                  description: 'Maximum reasoning',
                },
                { value: 'low', name: 'Low', description: 'Low' },
              ],
            }),
          ],
        },
      );

      const result = await adapter.getAvailableEffortsForModel('opus');

      expect(result?.availableEfforts).toEqual([
        { effortId: 'high', name: 'High', description: 'Maximum reasoning' },
        { effortId: 'low', name: 'Low', description: undefined },
      ]);
    });

    it('should return null when the agent does not publish a thought_level option for the model', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'probe-session',
        configOptions: [
          modelConfigOption({
            currentValue: 'sonnet-4.5',
            options: [{ value: 'sonnet-4.5', name: 'Sonnet 4.5' }],
          }),
        ],
      });
      acpHarness.connectionInstance?.setSessionConfigOption.mockResolvedValueOnce(
        {
          configOptions: [
            modelConfigOption({
              currentValue: 'sonnet-4.5',
              options: [{ value: 'sonnet-4.5', name: 'Sonnet 4.5' }],
            }),
          ],
        },
      );

      expect(
        await adapter.getAvailableEffortsForModel('sonnet-4.5'),
      ).toBeNull();
    });

    it('should not preserve the probe session as currentSessionId', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await adapter.getAvailableEffortsForModel('any-model');

      await expect(async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      }).rejects.toThrow('No active session');
    });

    it('should throw a transport error when newSession fails during probing', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockRejectedValueOnce(
        new Error('probe failed'),
      );

      await expect(
        adapter.getAvailableEffortsForModel('any-model'),
      ).rejects.toThrow('probe failed');
    });
  });

  describe('setConfig', () => {
    it('should be a no-op when no session is active (stores preference for later)', async () => {
      const adapter = new TestAcpAdapter();

      await expect(
        adapter.setConfig({ modelId: 'gpt-5' }),
      ).resolves.toBeUndefined();
      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toBeUndefined();
    });

    it('should call setSessionConfigOption for modelId only when only modelId is passed', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [
              { value: 'auto', name: 'Auto' },
              { value: 'gpt-5', name: 'GPT-5' },
            ],
          }),
        ],
      });
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.setSessionConfigOption.mockResolvedValueOnce(
        {
          configOptions: [
            modelConfigOption({
              currentValue: 'gpt-5',
              options: [
                { value: 'auto', name: 'Auto' },
                { value: 'gpt-5', name: 'GPT-5' },
              ],
            }),
          ],
        },
      );

      await adapter.setConfig({ modelId: 'gpt-5' });

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledTimes(1);
      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'model',
        value: 'gpt-5',
      });
      expect(adapter.getAvailableModels()?.currentModelId).toBe('gpt-5');
    });

    it('should call setSessionConfigOption twice when both modelId and effortId are passed', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [{ value: 'gpt-5', name: 'GPT-5' }],
          }),
          effortConfigOption({
            currentValue: 'low',
            options: [{ value: 'high', name: 'High' }],
          }),
        ],
      });
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.setSessionConfigOption
        .mockResolvedValueOnce({
          configOptions: [
            modelConfigOption({
              currentValue: 'gpt-5',
              options: [{ value: 'gpt-5', name: 'GPT-5' }],
            }),
            effortConfigOption({
              currentValue: 'low',
              options: [{ value: 'high', name: 'High' }],
            }),
          ],
        })
        .mockResolvedValueOnce({
          configOptions: [
            modelConfigOption({
              currentValue: 'gpt-5',
              options: [{ value: 'gpt-5', name: 'GPT-5' }],
            }),
            effortConfigOption({
              currentValue: 'high',
              options: [{ value: 'high', name: 'High' }],
            }),
          ],
        });

      await adapter.setConfig({ modelId: 'gpt-5', effortId: 'high' });

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).toHaveBeenCalledTimes(2);
    });

    it('should warn and do nothing when the requested category does not exist in config', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      await adapter.setConfig({ modelId: 'gpt-5' });

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('config_option_not_available: model=gpt-5'),
      );

      warnSpy.mockRestore();
    });

    it('should warn and do nothing when the requested value is not among options', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [{ value: 'auto', name: 'Auto' }],
          }),
        ],
      });
      await adapter.createSession('/repo');

      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      await adapter.setConfig({ modelId: 'nonexistent' });

      expect(
        acpHarness.connectionInstance?.setSessionConfigOption,
      ).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'config_option_value_unknown: model=nonexistent',
        ),
      );

      warnSpy.mockRestore();
    });

    it('should throw a transport error when setSessionConfigOption rejects', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'auto',
            options: [{ value: 'gpt-5', name: 'GPT-5' }],
          }),
        ],
      });
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.setSessionConfigOption.mockRejectedValueOnce(
        new Error('socket closed'),
      );

      await expect(adapter.setConfig({ modelId: 'gpt-5' })).rejects.toThrow(
        'socket closed',
      );
    });
  });

  describe('prompt', () => {
    it('should throw when called before connect()', async () => {
      const adapter = new TestAcpAdapter();

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow('Not connected');
    });

    it('should throw when called before createSession()', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow('No active session');
    });

    it('should deliver the final message block from accumulated text chunks', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      let resolvePrompt: () => void = () => undefined;
      acpHarness.connectionInstance?.prompt.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const received: AgentUpdate[] = [];
      const iterator = adapter.prompt('hello');
      const consumer = (async () => {
        for await (const update of iterator) {
          received.push(update);
        }
      })();

      await acpHarness.lastClient?.sessionUpdate(messageChunk('Hello '));
      await acpHarness.lastClient?.sessionUpdate(messageChunk('world!'));

      resolvePrompt();
      await consumer;

      expect(acpHarness.connectionInstance?.prompt).toHaveBeenCalledWith({
        sessionId: 'session-1',
        prompt: [{ type: 'text', text: 'hello' }],
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello world!' },
        },
      });
      expect(adapter.lastAgentMessage).toBe('Hello world!');
    });

    it('should yield nothing when prompt completes with empty text', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'end_turn',
      });

      const received: AgentUpdate[] = [];
      for await (const update of adapter.prompt('hello')) {
        received.push(update);
      }

      expect(received).toHaveLength(0);
      expect(adapter.lastAgentMessage).toBe('');
    });

    it('should capture the round token usage from the stop response', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      expect(await adapter.getLastRoundUsage()).toBeUndefined();

      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'end_turn',
        usage: {
          totalTokens: 150,
          inputTokens: 100,
          outputTokens: 50,
          thoughtTokens: 10,
          cachedReadTokens: null,
          cachedWriteTokens: null,
        },
      });

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toEqual({
        totalTokens: 150,
        inputTokens: 100,
        outputTokens: 50,
        thoughtTokens: 10,
        cachedReadTokens: undefined,
        cachedWriteTokens: undefined,
      });
    });

    it('should leave optional token fields undefined when omitted', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'end_turn',
        usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 },
      });

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toEqual({
        totalTokens: 30,
        inputTokens: 20,
        outputTokens: 10,
        thoughtTokens: undefined,
        cachedReadTokens: undefined,
        cachedWriteTokens: undefined,
      });
    });

    it('should resolve to undefined when the agent reports no usage', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'end_turn',
      });

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toBeUndefined();
    });

    it('should rethrow errors raised by connection.prompt', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockRejectedValue(
        new Error('agent crashed'),
      );

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow('agent crashed');
    });

    it('should throw PromptCancelledError immediately when cancel() was called before prompt()', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      await adapter.cancel();

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow(PromptCancelledError);
    });

    it('should throw PromptCancelledError when stopReason is cancelled', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'cancelled',
      });

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow(PromptCancelledError);
    });

    it('should throw PromptCancelledError when cancelled flag was set prior to completion', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      let resolvePrompt: (val: unknown) => void = () => undefined;
      acpHarness.connectionInstance?.prompt.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const promptPromise = (async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      })();

      await adapter.cancel();
      resolvePrompt({ stopReason: 'end_turn' });

      await expect(promptPromise).rejects.toThrow(PromptCancelledError);
    });

    it('should auto-select allow_always option', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const result = await acpHarness.lastClient?.requestPermission({
        options: [
          { optionId: 'no', kind: 'reject_once' },
          { optionId: 'once', kind: 'allow_once' },
          { optionId: 'always', kind: 'allow_always' },
        ],
      });

      expect(result).toEqual({
        outcome: { outcome: 'selected', optionId: 'always' },
      });
    });

    it('should auto-select allow_once when no allow_always is present', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const result = await acpHarness.lastClient?.requestPermission({
        options: [
          { optionId: 'no', kind: 'reject_always' },
          { optionId: 'once', kind: 'allow_once' },
        ],
      });

      expect(result).toEqual({
        outcome: { outcome: 'selected', optionId: 'once' },
      });
    });

    it('should fall back to the first option when no option declares an allow kind', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const result = await acpHarness.lastClient?.requestPermission({
        options: [{ optionId: 'allow' }, { optionId: 'deny' }],
      });

      expect(result).toEqual({
        outcome: { outcome: 'selected', optionId: 'allow' },
      });
    });

    it('should fall back to empty optionId when options is empty', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const result = await acpHarness.lastClient?.requestPermission({
        options: [],
      });

      expect(result).toEqual({
        outcome: { outcome: 'selected', optionId: '' },
      });
    });
  });

  describe('agentExtensionRequests', () => {
    it('should register no extension method by default', async () => {
      const adapter = new TestAcpAdapter();

      await adapter.connect();

      expect(acpHarness.lastClient?.extensionMethods).toEqual([]);
    });

    it('should register extension methods declared by override', async () => {
      const adapter = new ExtensionAcpAdapter();

      await adapter.connect();

      expect(acpHarness.lastClient?.extensionMethods).toEqual(['vendor/ask']);
    });

    it('should answer an extension request with the declared response', async () => {
      const adapter = new ExtensionAcpAdapter();
      await adapter.connect();

      const result = await acpHarness.lastClient?.extensionRequest(
        'vendor/ask',
        { question: 'what mode?' },
      );

      expect(result).toEqual({ answered: true });
    });
  });

  describe('getLastRoundUsage (fallback)', () => {
    it('should resolve usage from collectFallbackUsage when ACP reports none', async () => {
      const adapter = new FallbackAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.fallbackResult = {
        totalTokens: 130,
        inputTokens: 100,
        outputTokens: 20,
        thoughtTokens: 8,
        cachedReadTokens: 10,
        cachedWriteTokens: 0,
      };

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toEqual(adapter.fallbackResult);
      expect(adapter.collectFallbackCalls).toEqual(['session-1']);
    });

    it('should not call collectFallbackUsage when ACP already reported usage', async () => {
      const adapter = new FallbackAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.fallbackResult = {
        totalTokens: 999,
        inputTokens: 999,
        outputTokens: 0,
      };
      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'end_turn',
        usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 },
      });

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toEqual({
        totalTokens: 30,
        inputTokens: 20,
        outputTokens: 10,
        thoughtTokens: undefined,
        cachedReadTokens: undefined,
        cachedWriteTokens: undefined,
      });
      expect(adapter.collectFallbackCalls).toEqual([]);
    });

    it('should swallow a throwing collectFallbackUsage and resolve to undefined', async () => {
      const debugSpy = vi
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation(vi.fn());
      const adapter = new FallbackAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.fallbackError = new Error('db error');

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toBeUndefined();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback_usage_failed: db error'),
      );

      debugSpy.mockRestore();
    });

    it('should resolve fallback usage even on a cancelled round', async () => {
      const adapter = new FallbackAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.fallbackResult = {
        totalTokens: 5,
        inputTokens: 5,
        outputTokens: 0,
      };
      acpHarness.connectionInstance?.prompt.mockResolvedValueOnce({
        stopReason: 'cancelled',
      });

      await expect(async () => {
        for await (const _ of adapter.prompt('hello')) {
          // exhaust
        }
      }).rejects.toThrow(PromptCancelledError);

      expect(await adapter.getLastRoundUsage()).toEqual(adapter.fallbackResult);
      expect(adapter.collectFallbackCalls).toEqual(['session-1']);
    });

    it('should memoize fallback usage for repeat calls', async () => {
      const adapter = new FallbackAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.fallbackResult = {
        totalTokens: 7,
        inputTokens: 7,
        outputTokens: 0,
      };

      for await (const _ of adapter.prompt('hello')) {
        // exhaust
      }

      expect(await adapter.getLastRoundUsage()).toEqual(adapter.fallbackResult);
      expect(await adapter.getLastRoundUsage()).toEqual(adapter.fallbackResult);
      expect(adapter.collectFallbackCalls).toEqual(['session-1']);
    });
  });

  describe('onActivity', () => {
    const withTurn = async (
      adapter: TestAcpAdapter,
      drive: () => Promise<void>,
    ): Promise<void> => {
      let resolvePrompt: () => void = () => undefined;
      acpHarness.connectionInstance?.prompt.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      );
      const consumer = (async () => {
        for await (const _ of adapter.prompt('drive')) {
          // exhaust
        }
      })();
      await drive();
      resolvePrompt();
      await consumer;
    };

    it('should forward activities demuxed from session updates and allow unsubscribing', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const activities: AgentActivity[] = [];
      const unsubscribe = adapter.onActivity((act) => activities.push(act));

      await withTurn(adapter, async () => {
        await acpHarness.lastClient?.sessionUpdate({
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thinking...' },
          },
        });
      });

      expect(activities).toHaveLength(1);
      expect(activities[0]?.kind).toBe('thought');

      unsubscribe();

      await withTurn(adapter, async () => {
        await acpHarness.lastClient?.sessionUpdate({
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'More thoughts...' },
          },
        });
      });

      expect(activities).toHaveLength(1);
    });
  });

  describe('sendSteeringPrompt', () => {
    it('should be a no-op when not connected or no active session', () => {
      const adapter = new TestAcpAdapter();

      expect(() => adapter.sendSteeringPrompt('test')).not.toThrow();
    });

    it('should fall back to prompt request when steering is not supported', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      adapter.sendSteeringPrompt('redirect here');

      expect(acpHarness.connectionInstance?.prompt).toHaveBeenCalledWith({
        sessionId: 'session-1',
        prompt: [{ type: 'text', text: 'redirect here' }],
      });
    });

    it('should handle steering request failures gracefully without throwing', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockRejectedValueOnce(
        new Error('fail steer'),
      );
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      expect(() => adapter.sendSteeringPrompt('redirect')).not.toThrow();

      await new Promise((r) => setTimeout(r, 10));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('steering_prompt_failed'),
      );

      warnSpy.mockRestore();
    });

    it('should handle _session/steering rejection gracefully and log warning', async () => {
      acpHarness.pendingConnectionOverrides = {
        initialize: vi.fn().mockResolvedValue({
          _meta: { steering: { supported: true } },
        }),
      };

      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.steer.mockRejectedValueOnce(
        new Error('fail steer wire'),
      );
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      expect(() => adapter.sendSteeringPrompt('redirect wire')).not.toThrow();

      await new Promise((r) => setTimeout(r, 10));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('steering_inject_failed'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('closeSession', () => {
    it('should be a no-op when no active session', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      await adapter.closeSession();

      expect(acpHarness.connectionInstance?.closeSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });
    });

    it('should call session/close and clear current session', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      await adapter.closeSession();

      expect(acpHarness.connectionInstance?.closeSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });

      await expect(async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      }).rejects.toThrow('No active session');
    });

    it('should ignore close errors gracefully', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.closeSession.mockRejectedValueOnce(
        new Error('close fail'),
      );

      await expect(adapter.closeSession()).resolves.toBeUndefined();
    });
  });

  describe('cancel and escalation ladder', () => {
    it('should be a no-op when not connected or no active session', async () => {
      const adapter = new TestAcpAdapter();

      await expect(adapter.cancel()).resolves.toBeUndefined();
    });

    it('should send cancel notification and start escalation timer', async () => {
      vi.useFakeTimers();
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.prompt.mockImplementation(
        () => new Promise<void>(() => undefined),
      );

      const promptPromise = (async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      })();

      const rejection =
        expect(promptPromise).rejects.toBeInstanceOf(PromptCancelledError);

      await adapter.cancel();

      expect(acpHarness.connectionInstance?.cancel).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });

      // Escalate to abort steering
      await vi.advanceTimersByTimeAsync(5000);
      expect(acpHarness.connectionInstance?.prompt).toHaveBeenCalledWith({
        sessionId: 'session-1',
        prompt: [{ type: 'text', text: CANCEL_ABORT_PROMPT_TEXT }],
      });

      // Force cancel after grace (15s)
      await vi.advanceTimersByTimeAsync(15000);

      await rejection;
    });

    it('should emit cancellation activity on cancel', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const activities: AgentActivity[] = [];
      adapter.onActivity((a) => activities.push(a));

      let resolvePrompt: (val: unknown) => void = () => undefined;
      acpHarness.connectionInstance?.prompt.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const promptPromise = (async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      })();

      await adapter.cancel();
      resolvePrompt({ stopReason: 'cancelled' });

      try {
        await promptPromise;
      } catch {
        // ignore PromptCancelledError
      }

      expect(activities.some((a) => a.kind === 'cancelled')).toBe(true);
    });

    it('should log warning if sendCancelNotification fails', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      acpHarness.connectionInstance?.cancel.mockImplementationOnce(() => {
        throw new Error('cancel notify boom');
      });
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(vi.fn());

      await adapter.cancel();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('cancel_failed'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should be a no-op when not connected', async () => {
      const adapter = new TestAcpAdapter();

      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('should close connection, kill subprocess, and reset state', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      const proc = acpHarness.spawnedProcs[0];

      await adapter.disconnect();

      expect(proc?.kill).toHaveBeenCalled();
      expect(adapter.getAvailableModels()).toBeNull();
    });
  });

  describe('transport errors', () => {
    it('should wrap initialize() rejections from connect() with agent name', async () => {
      acpHarness.pendingConnectionOverrides = {
        initialize: vi.fn().mockRejectedValueOnce(new Error('init fail')),
      };

      const adapter = new TestAcpAdapter();
      await expect(adapter.connect()).rejects.toThrow(
        'Erro retornado pelo agente (test)',
      );
    });

    it('should wrap newSession() rejections from createSession', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockRejectedValueOnce(
        new Error('session failed'),
      );

      await expect(adapter.createSession('/repo')).rejects.toThrow(
        'Erro retornado pelo agente (test)',
      );
    });

    it('should format transport error with stderr buffer when present', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      const proc = acpHarness.spawnedProcs[0];
      let rejectNewSession: (err: Error) => void = () => undefined;
      acpHarness.connectionInstance?.newSession.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectNewSession = reject;
          }),
      );

      const sessionPromise = adapter.createSession('/repo');
      await Promise.resolve();

      proc?.stderr.emit(
        'data',
        Buffer.from('fatal: process crashed with error 123'),
      );
      rejectNewSession(new Error('channel closed'));

      await expect(sessionPromise).rejects.toThrow(
        /fatal: process crashed with error 123/,
      );
    });

    it('should stringify a non-Error rejection', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();

      acpHarness.connectionInstance?.newSession.mockRejectedValueOnce(
        'raw string error',
      );

      await expect(adapter.createSession('/repo')).rejects.toThrow(
        'raw string error',
      );
    });
  });

  describe('lastAgentMessage capture', () => {
    it('should update lastAgentMessage when text chunk arrives', async () => {
      const adapter = new TestAcpAdapter();
      await adapter.connect();
      await adapter.createSession('/repo');

      let resolvePrompt: () => void = () => undefined;
      acpHarness.connectionInstance?.prompt.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const consumer = (async () => {
        for await (const _ of adapter.prompt('hi')) {
          // exhaust
        }
      })();

      await acpHarness.lastClient?.sessionUpdate(messageChunk('captured text'));

      resolvePrompt();
      await consumer;

      expect(adapter.lastAgentMessage).toBe('captured text');
    });
  });
});
