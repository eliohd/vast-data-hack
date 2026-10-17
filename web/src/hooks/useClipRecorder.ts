import { useCallback, useRef, useState } from 'react';
import { pickRecorderMimeType } from '@/lib/frames';

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/**
 * Records a short clip from a live MediaStream. This is the "slow lane": clips get uploaded
 * and ingested into VSS, while single frames go over the WebSocket for instant answers.
 */
export function useClipRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const record = useCallback(
    (stream: MediaStream, maxMs = 10_000) =>
      new Promise<RecordedClip>((resolve, reject) => {
        const mimeType = pickRecorderMimeType();
        if (!mimeType) {
          reject(new Error('This browser cannot record video (no supported MediaRecorder type).'));
          return;
        }
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, { mimeType });
        const startedAt = performance.now();
        recorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => reject(new Error('Recording failed.'));
        recorder.onstop = () => {
          setRecording(false);
          recorderRef.current = null;
          resolve({
            blob: new Blob(chunks, { type: mimeType }),
            mimeType,
            durationMs: Math.round(performance.now() - startedAt),
          });
        };

        recorder.start(1000);
        setRecording(true);
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, maxMs);
      }),
    [],
  );

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  return { record, stop, recording };
}
