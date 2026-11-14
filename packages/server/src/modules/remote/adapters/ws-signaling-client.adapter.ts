import { parseToHostSignal, SIGNALING_CLOSE_CODES, type HostSignal } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { WebSocket } from 'ws';

import { parseJsonMessage } from '../../web/utils/json-message.util.js';
import type { ISignalingClientPort, SignalingClientOptions } from '../ports/signaling-client.port.js';


const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** The signaling server pings every 25 s; a socket quiet for longer than this is gone. */
const SILENCE_TIMEOUT_MS = 70_000;

@Injectable()
export class WsSignalingClientAdapter implements ISignalingClientPort, OnModuleDestroy {
  private readonly logger = new Logger(WsSignalingClientAdapter.name);
  private options?: SignalingClientOptions;
  private socket?: WebSocket;
  private attempt = 0;
  private reachable = true;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private silenceTimer?: ReturnType<typeof setTimeout>;

  start(options: SignalingClientOptions): void {
    this.options = options;
    this.open();
  }

  send(signal: HostSignal): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(signal));
    }
  }

  stop(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    this.socket?.terminate();
    this.socket = undefined;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  private open(): void {
    const { url, registration, onSignal } = this.options!;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.expectTraffic(socket);
    socket.on('open', () => socket.send(JSON.stringify(registration)));
    socket.on('ping', () => this.expectTraffic(socket));
    socket.on('message', (raw) => {
      this.expectTraffic(socket);
      const parsed = parseToHostSignal(parseJsonMessage(raw.toString()));
      if (!parsed.ok) {
        this.logger.warn(`signal_dropped: ${parsed.error}`);
        return;
      }
      if (parsed.value.type === 'host.registered') {
        this.attempt = 0;
        this.reachable = true;
        this.logger.log(`Remote access ready through ${new URL(url).host}`);
      }
      onSignal(parsed.value);
    });
    socket.on('error', () => undefined);
    socket.on('close', code => this.handleClose(socket, code));
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (socket !== this.socket) {
      return;
    }
    clearTimeout(this.silenceTimer);
    this.socket = undefined;
    if (code === SIGNALING_CLOSE_CODES.invalid || code === SIGNALING_CLOSE_CODES.replaced) {
      this.logger.error(code === SIGNALING_CLOSE_CODES.invalid
        ? 'Remote access refused: the signaling server did not accept this instance'
        : 'Remote access stopped: another server registered the same instance (same DATA_DIR)');
      return;
    }
    if (this.reachable) {
      this.reachable = false;
      this.logger.warn(`Remote access unavailable: cannot reach ${this.options!.url}, retrying`);
    }
    const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private expectTraffic(socket: WebSocket): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => socket.terminate(), SILENCE_TIMEOUT_MS);
  }
}
