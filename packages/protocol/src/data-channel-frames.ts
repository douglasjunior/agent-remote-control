/** UTF-16 code units per frame: even at three UTF-8 bytes each, a frame stays under the 64 KiB a data channel message carries everywhere. */
export const FRAME_PAYLOAD_LENGTH = 16_000;

/**
 * Splits a message into frames of `<index>/<count>\n<payload>`. A data channel is ordered and reliable and every
 * frame of a message is sent before the next message, so frames of different messages never interleave.
 */
export function toFrames(text: string, payloadLength = FRAME_PAYLOAD_LENGTH): string[] {
  const payloads: string[] = [];
  let start = 0;
  do {
    let end = Math.min(start + payloadLength, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    payloads.push(text.slice(start, end));
    start = end;
  } while (start < text.length);
  return payloads.map((payload, index) => `${index}/${payloads.length}\n${payload}`);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export type FrameResult =
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'partial' }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Joins the frames of `toFrames` back into messages, refusing any message longer than `maxMessageLength`. */
export class FrameAssembler {
  private parts: string[] = [];
  private expected = 0;
  private length = 0;

  constructor(private readonly maxMessageLength: number, private readonly payloadLength = FRAME_PAYLOAD_LENGTH) {}

  push(frame: string): FrameResult {
    const header = /^(\d+)\/(\d+)\n/.exec(frame);
    if (!header) {
      return this.fail('a frame without a header');
    }
    const index = Number(header[1]);
    const count = Number(header[2]);
    if (index !== this.parts.length || (index > 0 && count !== this.expected)) {
      return this.fail(`frame ${index}/${count} out of order`);
    }
    if (count < 1 || count > Math.ceil(this.maxMessageLength / this.payloadLength) + 1) {
      return this.fail(`a message of ${count} frames`);
    }
    const payload = frame.slice(header[0].length);
    this.length += payload.length;
    if (this.length > this.maxMessageLength) {
      return this.fail(`a message longer than ${this.maxMessageLength}`);
    }
    this.parts.push(payload);
    this.expected = count;
    if (this.parts.length < count) {
      return { kind: 'partial' };
    }
    const text = this.parts.join('');
    this.reset();
    return { kind: 'message', text };
  }

  private fail(reason: string): FrameResult {
    this.reset();
    return { kind: 'invalid', reason };
  }

  private reset(): void {
    this.parts = [];
    this.expected = 0;
    this.length = 0;
  }
}
