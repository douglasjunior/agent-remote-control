import { type HostSignal, parseToHostSignal, SIGNALING_CLOSE_CODES, type ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { WebSocket } from 'ws';

import { parseJsonMessage } from '../../web/utils/json-message.util.js';
import type { ISignalingClientPort, SignalingClientOptions } from '../ports/signaling-client.port.js';


const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** The signaling server pings every 25 s; a socket quiet for longer than this is gone. */
const SILENCE_TIMEOUT_MS = 70_000;
const STOP_MESSAGES: Readonly<Record<number, string>> = {
  [SIGNALING_CLOSE_CODES.invalid]: 'Remote access refused: the signaling server did not accept the registration of this instance',
  [SIGNALING_CLOSE_CODES.forbidden]: 'Remote access refused: the signaling server does not serve this instance',
  [SIGNALING_CLOSE_CODES.replaced]: 'Remote access stopped: another server registered the same instance (same DATA_DIR)',
};

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
    const { url } = this.options!;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.expectTraffic(socket);
    socket.on('ping', () => this.expectTraffic(socket));
    socket.on('message', (raw) => {
      this.expectTraffic(socket);
      const parsed = parseToHostSignal(parseJsonMessage(raw.toString()));
      if (!parsed.ok) {
        this.logger.warn(`signal_dropped: ${parsed.error}`);
        return;
      }
      this.handleSignal(socket, parsed.value);
    });
    socket.on('error', () => undefined);
    socket.on('close', code => this.handleClose(socket, code));
  }

  /** A signal that fails to be handled is logged: a listener of this socket that throws would end the process. */
  private handleSignal(socket: WebSocket, signal: ToHostSignal): void {
    const { url, register, onSignal } = this.options!;
    if (signal.type === 'host.challenge') {
      register(signal.nonce)
        .then(registration => socket === this.socket && socket.send(JSON.stringify(registration)))
        .catch((error: unknown) => this.logger.error(`signal_registration_failed: ${this.describe(error)}`));
      return;
    }
    if (signal.type === 'host.registered') {
      this.attempt = 0;
      this.reachable = true;
      this.logger.log(`Remote access ready through ${new URL(url).host}`);
    }
    try {
      onSignal(signal);
    } catch (error) {
      this.logger.error(`signal_handler_failed: ${signal.type}: ${this.describe(error)}`);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (socket !== this.socket) {
      return;
    }
    clearTimeout(this.silenceTimer);
    this.socket = undefined;
    if (code in STOP_MESSAGES) {
      this.logger.error(STOP_MESSAGES[code]);
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
