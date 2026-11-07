import { act, renderHook, waitFor } from '@testing-library/react';

import { audioInput, FakeMediaDevices } from '../../test/fake-media-devices.js';

import { MICROPHONE_STORAGE_KEY, useMicrophones } from './use-microphones.js';


let media: FakeMediaDevices;

beforeEach(() => {
  media = new FakeMediaDevices();
  media.devices = [
    audioInput('default', 'Default - Headset'),
    audioInput('communications', 'Communications - Headset'),
    audioInput('a', 'Headset'),
    audioInput('b', 'Desk mic'),
  ];
  media.install();
  localStorage.clear();
});

afterEach(() => {
  FakeMediaDevices.uninstall();
  vi.restoreAllMocks();
});

describe('useMicrophones', () => {
  it('lists the audio inputs without the browser virtual entries', async () => {
    media.devices.push({ deviceId: 'cam', kind: 'videoinput', label: 'Camera' });
    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current.devices).toEqual([
      { id: 'a', label: 'Headset' },
      { id: 'b', label: 'Desk mic' },
    ]));
    expect(result.current.selectedId).toBe('');
  });

  it('remembers the chosen microphone', async () => {
    const { result, unmount } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    act(() => result.current.select('b'));
    expect(result.current.selectedId).toBe('b');
    expect(localStorage.getItem(MICROPHONE_STORAGE_KEY)).toBe('b');

    unmount();
    const again = renderHook(() => useMicrophones());
    await waitFor(() => expect(again.result.current.selectedId).toBe('b'));
  });

  it('falls back to the default when the remembered microphone is gone, keeping the choice', async () => {
    localStorage.setItem(MICROPHONE_STORAGE_KEY, 'unplugged');
    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    expect(result.current.selectedId).toBe('');
    expect(localStorage.getItem(MICROPHONE_STORAGE_KEY)).toBe('unplugged');
  });

  it('names unnamed devices, then asks for access on load to read the real names', async () => {
    media.devices = [audioInput('a', ''), audioInput('b', '')];
    media.getUserMedia.mockImplementationOnce(() => {
      media.grantAccess();
      return Promise.resolve({ getTracks: () => [{ stop: media.stoppedTracks }] });
    });
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices.map(device => device.label)).toEqual(['Microphone 1', 'Microphone 2']));

    await act(() => result.current.load());

    expect(result.current.devices.map(device => device.label)).toEqual(['Mic a', 'Mic b']);
    expect(media.stoppedTracks).toHaveBeenCalled();
  });

  it('does not ask for access when every device is already named', async () => {
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    await act(() => result.current.load());

    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('keeps the generic names when access is denied', async () => {
    media.devices = [audioInput('a', '')];
    media.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices).toHaveLength(1));

    await act(() => result.current.load());

    expect(result.current.devices).toEqual([{ id: 'a', label: 'Microphone 1' }]);
  });

  it('follows devices being plugged in', async () => {
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    act(() => media.plug(audioInput('c', 'USB mic')));

    await waitFor(() => expect(result.current.devices.map(device => device.id)).toEqual(['a', 'b', 'c']));
  });

  it('stops following devices after unmount', async () => {
    const remove = vi.spyOn(media, 'removeEventListener');
    const { unmount } = renderHook(() => useMicrophones());

    unmount();

    expect(remove).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });

  it('survives an unreadable device list', async () => {
    media.enumerateDevices.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useMicrophones());

    await act(() => result.current.load());

    expect(result.current.devices).toEqual([]);
  });

  it('works without media devices (insecure page)', () => {
    FakeMediaDevices.uninstall();

    const { result } = renderHook(() => useMicrophones());

    expect(result.current.devices).toEqual([]);
  });

  it('still selects when the storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    act(() => result.current.select('b'));

    expect(result.current.selectedId).toBe('b');
  });
});
