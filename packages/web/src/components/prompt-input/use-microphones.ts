import { useCallback, useEffect, useState } from 'react';


export const MICROPHONE_STORAGE_KEY = 'arc.microphone';
export const DEFAULT_MICROPHONE_ID = '';

export type Microphone = {
  readonly id: string;
  readonly label: string;
};

const VIRTUAL_IDS = new Set(['default', 'communications']);

function readStoredId(): string {
  try {
    return localStorage.getItem(MICROPHONE_STORAGE_KEY) ?? DEFAULT_MICROPHONE_ID;
  } catch {
    return DEFAULT_MICROPHONE_ID;
  }
}

function storeId(id: string): void {
  try {
    localStorage.setItem(MICROPHONE_STORAGE_KEY, id);
  } catch {
    // Storage can be blocked; the choice then lasts until reload.
  }
}

/**
 * The audio inputs of the machine and the one chosen for recording (the system default until the user picks
 * another). Browsers hide device names until the microphone has been allowed once, so `load` asks for access
 * when it finds unnamed devices. The chosen id is remembered; a remembered device that is no longer plugged in
 * falls back to the system default without forgetting the choice.
 */
export function useMicrophones() {
  const [devices, setDevices] = useState<readonly Microphone[]>([]);
  const [storedId, setStoredId] = useState(readStoredId);

  const refresh = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter(device => device.kind === 'audioinput' && !VIRTUAL_IDS.has(device.deviceId));
    setDevices(inputs.map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` })));
    return inputs.some(device => device.label === '');
  }, []);

  const load = useCallback(async () => {
    try {
      if (await refresh()) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        await refresh();
      }
    } catch {
      // Without access the list keeps its generic names.
    }
  }, [refresh]);

  useEffect(() => {
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (!media) {
      return;
    }
    const update = () => void refresh().catch(() => undefined);
    update();
    media.addEventListener('devicechange', update);
    return () => media.removeEventListener('devicechange', update);
  }, [refresh]);

  const select = useCallback((id: string) => {
    storeId(id);
    setStoredId(id);
  }, []);

  const selectedId = devices.some(device => device.id === storedId) ? storedId : DEFAULT_MICROPHONE_ID;

  return { devices, selectedId, select, load };
}
