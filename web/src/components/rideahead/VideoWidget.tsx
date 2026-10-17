import { useEffect, useRef, useState } from 'react';
import { Camera, Video, X } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import { withDemoKey } from '@/lib/demoKey';
import { safeMediaPath, type EvidenceView } from '@/lib/rideahead/view';
import { captureJpeg } from '@/lib/frames';
import { LiveSocket } from '@/lib/socket';

export type CameraInference = { text: string; label: string; model: string; live: boolean };

export default function VideoWidget({
  evidence,
  onInference,
}: {
  evidence?: EvidenceView;
  onInference: (value: CameraInference | null) => void;
}) {
  const camera = useCamera();
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!analysing || camera.status !== 'live') return;
    let model = 'unknown';
    let active = true;
    let sequence = 0;
    let pending: { seq: number; at: number } | null = null;
    const socket = new LiveSocket({
      path: withDemoKey('/ws/live'),
      onState: (state) => {
        if (!active) return;
        if (state !== 'open') {
          pending = null;
          onInference({
            text: 'Waiting for the camera analysis connection.',
            label: state === 'connecting' ? 'Connecting' : 'Connection lost',
            model,
            live: false,
          });
        }
      },
      onMessage: (message) => {
        if (!active) return;
        if (message.type === 'hello') model = message.analyser;
        if (message.type === 'result' && pending?.seq === message.seq) {
          pending = null;
          onInference({
            text: message.summary,
            label:
              model === 'cosmos'
                ? `Live · ${message.processingMs} ms`
                : `${model} result · ${message.processingMs} ms`,
            model,
            live: model === 'cosmos',
          });
        }
        if (message.type === 'error') {
          pending = null;
          onInference({
            text: 'Camera analysis failed. Retry when the server is available.',
            label: 'Unavailable',
            model,
            live: false,
          });
          setAnalysing(false);
        }
      },
    });
    socket.connect();
    const timer = window.setInterval(() => {
      if (pending) {
        if (Date.now() - pending.at > 15000) {
          onInference({
            text: 'The model did not respond in time. Tap Analyse live to retry.',
            label: 'Timed out',
            model,
            live: false,
          });
          setAnalysing(false);
        }
        return;
      }
      if (!socket.ready || !camera.videoRef.current || !canvasRef.current) return;
      const frame = captureJpeg(camera.videoRef.current, canvasRef.current);
      if (!frame) return;
      const capturedAt = Date.now();
      const seq = ++sequence;
      if (socket.send({ type: 'frame', seq, capturedAt, ...frame }))
        pending = { seq, at: capturedAt };
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      socket.close();
    };
  }, [analysing, camera.status, camera.videoRef, onInference]);
  const media = safeMediaPath(evidence?.mediaPath ?? null);
  const local = camera.status === 'live' || camera.status === 'starting';
  return (
    <section className="ra-video-widget" aria-label="Road video overlay">
      <div className="ra-video-label">
        <Video size={12} />
        <span>{local ? 'Camera preview' : 'Road view'}</span>
        {local && (
          <button
            aria-label="Stop camera"
            onClick={() => {
              setAnalysing(false);
              camera.stop();
              onInference(null);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <video
        ref={camera.videoRef}
        hidden={!local}
        muted
        playsInline
        aria-label="Local camera preview"
      />
      <canvas ref={canvasRef} hidden />
      {!local &&
        (media && failedPath !== media ? (
          <video
            controls
            muted
            playsInline
            preload="metadata"
            aria-label="Recorded road clip"
            src={`${withDemoKey(media)}#t=${evidence?.clipStartS ?? 0},${evidence?.clipEndS ?? 0}`}
            onError={() => setFailedPath(media)}
          />
        ) : (
          <div className="ra-video-placeholder">
            <Camera size={23} />
            <span>{failedPath ? 'Clip unavailable' : 'No clip connected'}</span>
          </div>
        ))}
      {!local && (
        <button className="ra-enable-camera" onClick={() => void camera.start()}>
          <Camera size={11} />
          Use camera
        </button>
      )}
      {camera.status === 'live' && (
        <button
          className="ra-enable-camera"
          onClick={() => {
            setAnalysing(!analysing);
            if (analysing) onInference(null);
          }}
        >
          {analysing ? 'Pause analysis' : 'Analyse live'}
        </button>
      )}
      <span className="ra-video-caption">
        {local
          ? analysing
            ? 'Sending to analysis server'
            : 'Local preview · not analysed'
          : media
            ? 'Recorded evidence'
            : 'Awaiting recorded video'}
      </span>
      {camera.error && (
        <p className="ra-camera-error" role="alert">
          Camera unavailable. Check browser permissions.
        </p>
      )}
    </section>
  );
}
