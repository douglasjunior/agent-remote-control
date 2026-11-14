import type { HostSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';

import type { ISignalingClientPort, SignalingClientOptions } from '../ports/signaling-client.port.js';


export class FakeSignalingClient implements ISignalingClientPort {
  options?: SignalingClientOptions;
  readonly sent: HostSignal[] = [];
  stopped = false;

  start(options: SignalingClientOptions): void {
    this.options = options;
  }

  send(signal: HostSignal): void {
    this.sent.push(signal);
  }

  stop(): void {
    this.stopped = true;
  }

  receive(signal: ToHostSignal): void {
    this.options?.onSignal(signal);
  }
}
