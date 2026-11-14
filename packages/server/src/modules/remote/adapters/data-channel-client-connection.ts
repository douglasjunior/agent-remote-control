import { FrameAssembler, toFrames } from '@agent-remote-control/protocol/data-channel-frames';
import type { ServerEvent } from '@agent-remote-control/protocol/server-event';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { IClientConnection } from '../../web/ports/client-transport.port.js';
import { parseJsonMessage } from '../../web/utils/json-message.util.js';
import type { IRemoteChannel } from '../ports/remote-peer.port.js';


/** Same limit as the WebSocket payload: a command, an upload chunk included, is far smaller. */
const MAX_COMMAND_LENGTH = 256 * 1024;

/** A browser connected over a data channel, its messages split in frames both ways. */
export class DataChannelClientConnection implements IClientConnection {
  readonly id = randomUUID();
  private readonly logger = new Logger(DataChannelClientConnection.name);
  private readonly assembler = new FrameAssembler(MAX_COMMAND_LENGTH);

  constructor(private readonly channel: IRemoteChannel) {}

  send(event: ServerEvent): void {
    toFrames(JSON.stringify(event)).forEach(frame => this.channel.send(frame));
  }

  onMessage(listener: (data: unknown) => void): () => void {
    return this.channel.onMessage((frame) => {
      const result = this.assembler.push(frame);
      if (result.kind === 'message') {
        listener(parseJsonMessage(result.text));
      }
      if (result.kind === 'invalid') {
        this.logger.warn(`frame_rejected: connection=${this.id} reason=${result.reason}`);
        this.channel.close();
      }
    });
  }

  onClose(listener: () => void): () => void {
    return this.channel.onClose(listener);
  }

  /** A data channel carries no close code; the browser reads an `auth.failed` sent before closing. */
  close(): void {
    this.channel.close();
  }
}
