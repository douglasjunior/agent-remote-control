import { useCallback, useEffect, useRef, useState } from 'react';


const FORMATS = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
] as const;

export type VoiceRecorderStatus = 'idle' | 'starting' | 'recording';

const pickFormat = () => FORMATS.find(format => MediaRecorder.isTypeSupported(format.mimeType));

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function describeFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError') {
    return 'Microphone access was denied';
  }
  if (name === 'OverconstrainedError' || name === 'NotFoundError') {
    return 'The selected microphone is not available';
  }
  return 'Could not start the recording';
}

/**
 * Records the microphone. `finish` stops the recording and resolves with the audio as a `File`;
 * `cancel` discards it. The microphone is released as soon as the recording ends or the component unmounts.
 */
export function useVoiceRecorder() {
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const startedAt = useRef(0);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
    }
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (status !== 'recording') {
      return;
    }
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [status]);

  const start = useCallback(async (deviceId?: string) => {
    if (status !== 'idle') {
      return;
    }
    setError(null);
    setStatus('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      const format = pickFormat();
      const instance = new MediaRecorder(media, format ? { mimeType: format.mimeType } : undefined);
      stream.current = media;
      recorder.current = instance;
      chunks.current = [];
      cancelled.current = false;
      instance.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      startedAt.current = Date.now();
      setElapsedSeconds(0);
      instance.start();
      setStatus('recording');
    } catch (cause) {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
      setStatus('idle');
      setError(describeFailure(cause));
    }
  }, [status]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.stop();
    }
    chunks.current = [];
    release();
  }, [release]);

  const finish = useCallback((): Promise<File | null> => {
    const active = recorder.current;
    if (!active || active.state === 'inactive') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      active.onstop = () => {
        const mimeType = active.mimeType || FORMATS[0].mimeType;
        const extension = FORMATS.find(format => mimeType.startsWith(format.mimeType.split(';')[0]!))?.extension ?? 'webm';
        const blob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        release();
        resolve(cancelled.current || blob.size === 0 ? null : new File([blob], `recording-${timestamp()}.${extension}`, { type: mimeType }));
      };
      cancelled.current = false;
      active.stop();
    });
  }, [release]);

  return { status, elapsedSeconds, error, start, cancel, finish };
}
