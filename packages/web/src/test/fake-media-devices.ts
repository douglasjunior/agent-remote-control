import type { Mock } from 'vitest';


export type FakeDevice = { readonly deviceId: string; readonly kind: MediaDeviceKind; readonly label: string };

/** The browser's `navigator.mediaDevices`, with a list of devices the test can change. */
export class FakeMediaDevices extends EventTarget {
  devices: FakeDevice[] = [];
  readonly stoppedTracks: Mock = vi.fn();
  readonly getUserMedia: Mock<(constraints?: MediaStreamConstraints) => Promise<unknown>> = vi.fn((_constraints?: MediaStreamConstraints) => Promise.resolve({
    getTracks: () => [{ stop: this.stoppedTracks }],
  }));

  enumerateDevices = vi.fn(() => Promise.resolve(this.devices));

  /** Browsers hide labels until the microphone was allowed once. */
  grantAccess(): void {
    this.devices = this.devices.map(device => ({ ...device, label: device.label || `Mic ${device.deviceId}` }));
  }

  plug(device: FakeDevice): void {
    this.devices = [...this.devices, device];
    this.dispatchEvent(new Event('devicechange'));
  }

  install(): void {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: this });
  }

  static uninstall(): void {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
}

export const audioInput = (deviceId: string, label: string): FakeDevice => ({ deviceId, kind: 'audioinput', label });
