import { describe, expect, it } from 'vitest';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { AgentConfigSelection } from '../../orchestrator/models/agent-config-selection.model.js';

import { DiscordActivityFormatter } from './discord-activity.formatter.js';


describe('DiscordActivityFormatter', () => {
  const formatter = new DiscordActivityFormatter();

  describe('formatActivity', () => {
    it('should format single-line thought activity as a blockquote with emoji', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '1',
        text: 'Analyzing project structure...',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('> 💭 *Analyzing project structure...*');
    });

    it('should format multi-line thought activity preserving lines in blockquote', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '2',
        text: 'First step.\nSecond step.',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('> 💭 *First step.*\n> *Second step.*');
    });

    it('should return null for empty or whitespace-only thought', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '3',
        text: '   \n  ',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should format tool in_progress status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-1',
        title: 'git status',
        status: 'in_progress',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('⏳ **Executando**: `git status`');
    });

    it('should format tool completed status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-2',
        title: 'git diff',
        status: 'completed',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('✅ **Concluído**: `git diff`');
    });

    it('should format tool failed status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-3',
        title: 'git push',
        status: 'failed',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('❌ **Falhou**: `git push`');
    });

    it('should return null for unhandled tool status', () => {
      const activity = {
        kind: 'tool',
        toolCallId: 'call-4',
        title: 'unknown tool',
        status: 'pending' as any,
      } as AgentActivity;

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should return null for steering activity', () => {
      const activity: AgentActivity = {
        kind: 'steering',
        id: 'steer-1',
        text: 'Adjust course',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should return null for cancelled activity', () => {
      const activity: AgentActivity = {
        kind: 'cancelled',
        id: 'cancel-1',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });
  });

  describe('splitMessage', () => {
    it('should return empty array for empty string', () => {
      expect(formatter.splitMessage('')).toEqual([]);
    });

    it('should return single chunk if content is within maxLength', () => {
      const content = 'Hello Discord!';
      expect(formatter.splitMessage(content, 2000)).toEqual(['Hello Discord!']);
    });

    it('should split multi-line content without exceeding maxLength', () => {
      const lines = [
        'Line 1: Some content here',
        'Line 2: Another line of content',
        'Line 3: Final line here',
      ];
      const content = lines.join('\n');

      const chunks = formatter.splitMessage(content, 35);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
      }
      expect(chunks.join('\n')).toBe(content);
    });

    it('should properly close and reopen code blocks across chunk splits', () => {
      const content = [
        '```typescript',
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        '```',
      ].join('\n');

      const chunks = formatter.splitMessage(content, 35);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
        expect(chunk.startsWith('```typescript')).toBe(true);
        expect(chunk.endsWith('```')).toBe(true);
      }
    });

    it('should split long single line exceeding maxLength', () => {
      const longLine = 'A'.repeat(50);
      const chunks = formatter.splitMessage(longLine, 20);

      expect(chunks).toEqual(['A'.repeat(20), 'A'.repeat(20), 'A'.repeat(10)]);
    });

    it('should split long single line inside code block and wrap each slice in code fences', () => {
      const longCodeLine = 'const x = ' + '9'.repeat(60) + ';';
      const content = `\`\`\`js\n${longCodeLine}\n\`\`\``;

      const chunks = formatter.splitMessage(content, 35);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
        expect(chunk.startsWith('```js')).toBe(true);
        expect(chunk.endsWith('```')).toBe(true);
      }
    });

    it('should properly close unclosed code block at end of content when split', () => {
      const content = '```python\n' + 'print("hello")\n'.repeat(5);
      const chunks = formatter.splitMessage(content, 40);

      expect(chunks.length).toBeGreaterThan(1);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk?.endsWith('```')).toBe(true);
    });

    it('should handle code blocks closing on regular boundary', () => {
      const content = 'Before code\n```python\nprint("hello")\n```\nAfter code';
      const chunks = formatter.splitMessage(content, 30);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(30);
      }
    });

    it('should split before a fence line when current chunk is full', () => {
      const content = 'Line 1 is quite long here\n```ts\nconst x = 1;\n```';
      const chunks = formatter.splitMessage(content, 26);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toBe('Line 1 is quite long here');
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(26);
      }
    });

    it('should keep lines after a sliced long line inside the code block', () => {
      const content = ['```ts', 'x'.repeat(50), 'const after = 1;', '```', 'outside'].join('\n');

      const chunks = formatter.splitMessage(content, 30);

      const afterChunk = chunks.find(chunk => chunk.includes('const after = 1;'))!;
      expect(afterChunk.startsWith('```ts\n')).toBe(true);
      expect(afterChunk.indexOf('const after = 1;')).toBeLessThan(afterChunk.lastIndexOf('```'));
      const outsideChunk = chunks.find(chunk => chunk.includes('outside'))!;
      expect(outsideChunk.match(/```/g)?.length ?? 0).toBe(0);
    });

    it('should reserve room for the closing fence when an opening fence fills the chunk', () => {
      const content = `${'a'.repeat(14)}\n\`\`\`ts\ncode\n\`\`\``;

      const chunks = formatter.splitMessage(content, 20);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(20);
      }
    });

    describe('invariants', () => {
      const samples: [string, number][] = [
        [['intro', '```ts', 'x'.repeat(90), 'y', '```', 'z'.repeat(45)].join('\n'), 30],
        [['```', 'a'.repeat(10), '```', '```js', 'b'.repeat(70), '```'].join('\n'), 25],
        [Array.from({ length: 40 }, (_, i) => (i % 7 === 0 ? '```py' : `line ${i}`)).join('\n'), 40],
        [`${'q'.repeat(15)}\n\`\`\`\n${'w'.repeat(15)}\n\`\`\``, 20],
        ['```sh\n' + 'c'.repeat(300), 50],
      ];

      const withoutFences = (text: string): string =>
        text.split('\n').filter(line => !/^```/.test(line)).join('');

      it.each(samples)('should respect maxLength and balance fences (%#)', (content, maxLength) => {
        const chunks = formatter.splitMessage(content, maxLength);

        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(maxLength);
          expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0);
        }
        expect(withoutFences(chunks.join('\n'))).toBe(withoutFences(content));
      });
    });
  });

  describe('agent configuration', () => {
    const selection: AgentConfigSelection = {
      channelId: 'ch-1',
      step: 'model',
      options: [
        { index: 1, id: 'fast', label: 'Fast Model', description: 'Quick answers' },
        { index: 2, id: 'deep', label: 'Deep Model' },
      ],
    };

    it('should format the footer with model and effort', () => {
      expect(
        formatter.formatAgentFooter({
          roleName: 'CEO',
          agentName: 'agy',
          modelName: 'Deep Model',
          effortName: 'High',
        }),
      ).toBe('-# 🤖 CEO (agy) · 🧠 Deep Model · ⚡ High');
    });

    it('should announce a delegation with and without a project', () => {
      const delegation = { round: 1, role: 'DEVELOPER', roleName: 'Desenvolvedor' };

      expect(formatter.formatDelegation({ ...delegation, phase: 'started', projectName: 'my-app' })).toBe(
        '🔀 **Tarefa delegada** ao agente **Desenvolvedor** (`DEVELOPER`) no projeto `my-app` — ele assumiu a tarefa agora.',
      );
      expect(formatter.formatDelegation({ ...delegation, phase: 'started' })).toBe(
        '🔀 **Tarefa delegada** ao agente **Desenvolvedor** (`DEVELOPER`) — ele assumiu a tarefa agora.',
      );
      expect(formatter.formatDelegation({ ...delegation, phase: 'finished' })).toBe(
        '↩️ **Desenvolvedor concluiu** — o CEO está revisando o resultado.',
      );
    });

    it('should name the delegate in its progress header', () => {
      expect(formatter.formatDelegateProgressHeader('Desenvolvedor')).toBe('🤖 **Progresso — Desenvolvedor**:\n');
    });

    it('should fall back to the default label in the footer', () => {
      expect(formatter.formatAgentFooter({ roleName: 'CEO', agentName: 'agy' })).toBe(
        '-# 🤖 CEO (agy) · 🧠 padrão · ⚡ padrão',
      );
    });

    it.each([
      [850, '850'],
      [12_345, '12.3k'],
      [2_500_000, '2.5M'],
    ])('should append the token usage %i to the footer', (totalTokens, label) => {
      expect(
        formatter.formatAgentFooter(
          { roleName: 'CEO', agentName: 'agy' },
          { totalTokens, inputTokens: 0, outputTokens: 0 },
        ),
      ).toBe(`-# 🤖 CEO (agy) · 🧠 padrão · ⚡ padrão · 🪙 ${label} tokens`);
    });

    it('should list the model options', () => {
      expect(formatter.formatSelection(selection)).toBe(
        [
          '🧠 **Escolha o modelo do agente** respondendo com o número da opção:',
          '**1.** Fast Model — Quick answers',
          '**2.** Deep Model',
        ].join('\n'),
      );
    });

    it('should name the selected model in the effort step', () => {
      const text = formatter.formatSelection({
        ...selection,
        step: 'effort',
        selectedModel: { id: 'deep', name: 'Deep Model' },
      });

      expect(text.split('\n')[0]).toBe(
        '⚡ **Escolha o effort para Deep Model** respondendo com o número da opção:',
      );
    });

    it('should explain the valid range on an invalid answer', () => {
      expect(formatter.formatInvalidSelection(selection)).toMatch(
        /^⚠️ Opção inválida\. Responda apenas com um número de 1 a 2\.\n\n🧠/,
      );
    });

    it('should confirm the saved settings', () => {
      const settings = {
        modelId: 'deep',
        modelName: 'Deep Model',
        effortId: null,
        effortName: null,
        updatedAt: '',
      };

      expect(formatter.formatConfigured(settings)).toBe(
        '✅ **Configuração salva**: 🧠 Deep Model · ⚡ padrão',
      );
      expect(formatter.formatConfigured({ ...settings, effortId: 'high', effortName: 'High' })).toBe(
        '✅ **Configuração salva**: 🧠 Deep Model · ⚡ High',
      );
    });
  });
});
