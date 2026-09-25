import { Injectable } from '@nestjs/common';
import type { AgentActivity } from '../../agent/ports/agent.port.js';

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

    const lines = content.split('\n');
    const chunks: string[] = [];
    let currentChunk = '';
    let inCodeBlock = false;
    let codeBlockLang = '';

    const updateFenceState = (line: string): void => {
      const match = line.match(/^```(\w*)/);
      if (!match) {
        return;
      }
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = match[1] ?? '';
      } else {
        inCodeBlock = false;
        codeBlockLang = '';
      }
    };

    for (const line of lines) {
      const isFenceLine = /^```(\w*)/.test(line);
      const closeFenceOverhead = inCodeBlock && !isFenceLine ? 4 : 0;
      const candidateLength =
        (currentChunk.length > 0 ? currentChunk.length + 1 : 0) +
        line.length +
        closeFenceOverhead;

      if (candidateLength <= maxLength) {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
        updateFenceState(line);
        continue;
      }

      if (currentChunk.length > 0) {
        if (inCodeBlock) {
          chunks.push(`${currentChunk}\n\`\`\``);
          currentChunk = `\`\`\`${codeBlockLang}`;
        } else {
          chunks.push(currentChunk);
          currentChunk = '';
        }
      }

      const availableLength =
        maxLength -
        (currentChunk.length > 0 ? currentChunk.length + 1 : 0) -
        (inCodeBlock ? 4 : 0);

      if (line.length <= availableLength) {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
        updateFenceState(line);
        continue;
      }

      const lineSlices = this.sliceLongLine(
        line,
        maxLength,
        inCodeBlock,
        codeBlockLang,
      );

      for (let i = 0; i < lineSlices.length; i++) {
        const slice = lineSlices[i]!;
        const isLastSlice = i === lineSlices.length - 1;

        if (isLastSlice && slice.length < maxLength) {
          currentChunk = slice;
        } else {
          chunks.push(slice);
        }
      }
    }

    if (currentChunk.length > 0) {
      if (inCodeBlock) {
        chunks.push(`${currentChunk}\n\`\`\``);
      } else {
        chunks.push(currentChunk);
      }
    }

    return chunks;
  }

  private sliceLongLine(
    line: string,
    maxLength: number,
    inCodeBlock: boolean,
    lang: string,
  ): string[] {
    const slices: string[] = [];

    if (!inCodeBlock) {
      let offset = 0;
      while (offset < line.length) {
        slices.push(line.slice(offset, offset + maxLength));
        offset += maxLength;
      }
      return slices;
    }

    const openFence = `\`\`\`${lang}\n`;
    const closeFence = '\n```';
    const payloadCapacity = maxLength - openFence.length - closeFence.length;
    const safeCapacity = payloadCapacity > 0 ? payloadCapacity : maxLength;

    let offset = 0;
    while (offset < line.length) {
      const chunkText = line.slice(offset, offset + safeCapacity);
      slices.push(`${openFence}${chunkText}${closeFence}`);
      offset += safeCapacity;
    }

    return slices;
  }
}
