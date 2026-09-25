import { Injectable } from '@nestjs/common';

import type { AgentActivity } from '../../agent/ports/agent.port.js';


const FENCE_PATTERN = /^```\w*/;
const CLOSE_FENCE = '\n```';

@Injectable()
export class DiscordActivityFormatter {
  formatActivity(activity: AgentActivity): string | null {
    if (activity.kind === 'thought') {
      const text = activity.text.trim();
      if (!text) {
        return null;
      }
      const lines = text.split('\n');
      return lines
        .map((line, index) => (index === 0 ? `> 💭 *${line}*` : `> *${line}*`))
        .join('\n');
    }

    if (activity.kind === 'tool') {
      switch (activity.status) {
        case 'in_progress':
          return `⏳ **Executando**: \`${activity.title}\``;
        case 'completed':
          return `✅ **Concluído**: \`${activity.title}\``;
        case 'failed':
          return `❌ **Falhou**: \`${activity.title}\``;
        default:
          return null;
      }
    }

    return null;
  }

  splitMessage(content: string, maxLength = 2000): string[] {
    if (!content) {
      return [];
    }

    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let lines: string[] = [];
    let length = 0;
    let openFence: string | null = null;

    const append = (line: string): void => {
      length += (lines.length > 0 ? 1 : 0) + line.length;
      lines.push(line);
    };
    const room = (reserve: number): number =>
      maxLength - length - (lines.length > 0 ? 1 : 0) - reserve;
    const flush = (): void => {
      chunks.push(lines.join('\n') + (openFence ? CLOSE_FENCE : ''));
      lines = [];
      length = 0;
      if (openFence) {
        append(openFence);
      }
    };

    for (const line of content.split('\n')) {
      const fence = line.match(FENCE_PATTERN)?.[0];
      const nextFence: string | null = fence ? (openFence ? null : fence) : openFence;
      const reserve = nextFence ? CLOSE_FENCE.length : 0;

      if (line.length > room(reserve) && lines.length > 0) {
        flush();
      }

      let rest = line;
      while (rest.length > room(reserve)) {
        const capacity = Math.max(1, room(openFence ? CLOSE_FENCE.length : 0));
        append(rest.slice(0, capacity));
        rest = rest.slice(capacity);
        flush();
      }
      append(rest);
      openFence = nextFence;
    }

    chunks.push(lines.join('\n') + (openFence ? CLOSE_FENCE : ''));
    return chunks;
  }
}
