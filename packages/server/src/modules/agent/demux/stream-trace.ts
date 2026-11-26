import { createHash } from 'node:crypto';


const MAX_EVENTS = 200;
const MAX_TITLE_LENGTH = 60;
const HASH_LENGTH = 8;

export type ChunkShape = {
  readonly update: string;
  readonly hasMessageId: boolean;
  readonly contentType: string;
};

type MessageRun = {
  readonly kind: 'message';
  readonly id: string;
  readonly isThought: boolean;
  readonly again: boolean;
  chunks: number;
  text: string;
};

type ToolEvent = {
  readonly kind: 'tool';
  readonly toolCallId: string;
  readonly title: string;
};

type TraceEvent = MessageRun | ToolEvent;

/**
 * What the demux saw in one prompt round, in order, for diagnosing how a response was assembled: a run of chunks of
 * one message, and each tool call. Message ids are the agent's own or `synthetic:N` when it sent none.
 */
export class StreamTrace {
  private readonly events: TraceEvent[] = [];
  private readonly seenIds = new Set<string>();
  private readonly shapes = new Map<string, ChunkShape>();

  reset(): void {
    this.events.length = 0;
    this.seenIds.clear();
    this.shapes.clear();
  }

  recordChunk(id: string, text: string, isThought: boolean, shape: ChunkShape): void {
    const last = this.events.at(-1);

    if (last?.kind === 'message' && last.id === id) {
      last.chunks += 1;
      last.text += text;
      return;
    }

    this.events.push({ kind: 'message', id, isThought, again: this.seenIds.has(id), chunks: 1, text });
    this.seenIds.add(id);

    if (!this.shapes.has(id)) {
      this.shapes.set(id, shape);
    }
  }

  recordToolCall(toolCallId: string, title: string | undefined): void {
    this.events.push({ kind: 'tool', toolCallId, title: this.oneLine(title ?? '') });
  }

  /** The events on one line: `msg(id,chunks,chars,sha)` per run (`again` when the id had chunks earlier) and `tool(id,title)`. */
  describeEvents(): string {
    return this.capped(this.events.map(event => this.describeEvent(event)));
  }

  /** The first chunk of each message id: the ACP update type, whether it carried a `messageId` and its content type. */
  describeShapes(): string {
    return this.capped([...this.shapes].map(([id, shape]) =>
      `shape(id=${id},update=${shape.update},messageId=${shape.hasMessageId ? 'present' : 'absent'},content=${shape.contentType})`));
  }

  private describeEvent(event: TraceEvent): string {
    if (event.kind === 'tool') {
      return `tool(id=${event.toolCallId},title="${event.title}")`;
    }
    const text = event.text.trim();
    const parts = [
      `id=${event.id}`,
      `chunks=${event.chunks}`,
      `chars=${text.length}`,
      `sha=${this.shortHash(text)}`,
      ...(event.again ? ['again'] : []),
    ];
    return `${event.isThought ? 'thought' : 'msg'}(${parts.join(',')})`;
  }

  private shortHash(text: string): string {
    return createHash('sha1').update(text).digest('hex').slice(0, HASH_LENGTH);
  }

  private oneLine(text: string): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > MAX_TITLE_LENGTH ? `${singleLine.slice(0, MAX_TITLE_LENGTH)}...` : singleLine;
  }

  private capped(items: readonly string[]): string {
    if (items.length === 0) {
      return 'none';
    }
    const shown = items.slice(0, MAX_EVENTS).join(' ');
    return items.length > MAX_EVENTS ? `${shown} ... +${items.length - MAX_EVENTS} more` : shown;
  }
}
