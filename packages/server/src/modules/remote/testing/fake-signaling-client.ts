import type { HostSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';

import type { ISignalingClientPort, SignalingClientOptions } from '../ports/signaling-client.port.js';


export class FakeSignalingClient implements ISignalingClientPort {
  options?: SignalingClientOptions;
  readonly sent: HostSignal[] = [];
  stopped = false;
  starts = 0;

  start(options: SignalingClientOptions): void {
    this.options = options;
    this.starts += 1;
    this.stopped = false;
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
