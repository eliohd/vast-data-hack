import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';
export type Facing = 'environment' | 'user';

/**
 * Rear-camera access that behaves on iOS Safari: the <video> must be playsInline + muted,
 * and start() must be called from a tap. getUserMedia also needs HTTPS (or localhost).
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(
    async (nextFacing: Facing = facing) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera needs HTTPS (or localhost) and a browser that supports getUserMedia.');
        setStatus('error');
        return;
      }
      stop();
      setStatus('starting');
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setFacing(nextFacing);
        setStatus('live');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [facing, stop],
  );

  const flip = useCallback(
    () => start(facing === 'environment' ? 'user' : 'environment'),
    [facing, start],
  );

  useEffect(() => stop, [stop]);

  return { videoRef, streamRef, status, error, facing, start, stop, flip };
}
