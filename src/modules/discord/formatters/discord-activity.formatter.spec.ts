import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '../../agent/ports/agent.port.js';
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
  });
});
