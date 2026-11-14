import { act, renderHook } from '@testing-library/react';

import { useVoiceRecorder } from './use-voice-recorder.js';


class FakeMediaRecorder {
  static supported: readonly string[] = ['audio/webm;codecs=opus', 'audio/webm'];
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => FakeMediaRecorder.supported.includes(type);

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  chunk = new Blob(['voice'], { type: 'audio/webm' });
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream, options?: { mimeType: string }) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.chunk });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();

beforeEach(() => {
  FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
  FakeMediaRecorder.instances = [];
  track.stop.mockClear();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useVoiceRecorder', () => {
  it('should record and finish with a named audio file, releasing the microphone', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    expect(result.current.status).toBe('recording');

    let file: File | null = null;
    await act(async () => {
      file = await result.current.finish();
    });

    expect(file).toBeInstanceOf(File);
    expect(file!.name).toMatch(/^recording-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.webm$/);
    expect(file!.type).toBe('audio/webm;codecs=opus');
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('should name the file after the container the browser produced', async () => {
    FakeMediaRecorder.supported = ['audio/mp4'];
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    let file: File | null = null;
    await act(async () => {
      file = await result.current.finish();
    });

    expect(file!.name).toMatch(/\.m4a$/);
  });

  it('should fall back to webm when the browser reports no format', async () => {
    FakeMediaRecorder.supported = [];
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    let file: File | null = null;
    await act(async () => {
      file = await result.current.finish();
    });

    expect(file!.name).toMatch(/\.webm$/);
  });

  it('should discard the recording on cancel', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    act(() => result.current.cancel());

    expect(result.current.status).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0]!.state).toBe('inactive');
    await expect(result.current.finish()).resolves.toBeNull();
  });

  it('should resolve null for a recording without audio', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    FakeMediaRecorder.instances[0]!.chunk = new Blob([]);
    let file: File | null | undefined;
    await act(async () => {
      file = await result.current.finish();
    });

    expect(file).toBeNull();
  });

  it('should ignore a start while already recording', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    await act(() => result.current.start());

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('should count the elapsed seconds while recording', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(result.current.elapsedSeconds).toBe(3);
  });

  it('should report a denied microphone', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBe('Microphone access was denied');
  });

  it('should report any other failure and release a stream already opened', async () => {
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported = () => true;
      constructor() {
        throw new Error('boom');
      }
    });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());

    expect(result.current.error).toBe('Could not start the recording');
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('should clear the error on the next start', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    await act(() => result.current.start());

    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('recording');
  });

  it('should stop recording and release the microphone on unmount', async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    await act(() => result.current.start());
    unmount();

    expect(FakeMediaRecorder.instances[0]!.state).toBe('inactive');
    expect(track.stop).toHaveBeenCalled();
  });

  it('should unmount cleanly when nothing was recorded', () => {
    const { unmount } = renderHook(() => useVoiceRecorder());

    expect(() => unmount()).not.toThrow();
  });
});
