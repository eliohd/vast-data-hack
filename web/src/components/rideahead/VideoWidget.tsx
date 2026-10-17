import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, FlaskConical, Minimize2, Video, X } from 'lucide-react';
import { useCamera } from '@/hooks/useCamera';
import { withDemoKey } from '@/lib/demoKey';
import type { RoadView } from '@/lib/rideahead/roadView';
import { captureJpeg } from '@/lib/frames';
import { LiveSocket } from '@/lib/socket';

export type CameraInference = { text: string; label: string; model: string; live: boolean };

type ClipStatus = 'loading' | 'playing' | 'blocked' | 'ended' | 'error';

/** Recorded clip for the current observation. Autoplays once per clip; never fails silently. */
function RecordedClip({ view }: { view: Extract<RoadView, { kind: 'recorded' }> }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ClipStatus>('loading');
  const play = () => {
    const el = ref.current;
    if (!el) return;
    if (el.currentTime < view.startS || (view.endS != null && el.currentTime >= view.endS))
      el.currentTime = view.startS;
    el.play().then(
      () => setStatus('playing'),
      (cause: unknown) => {
        // A newer load interrupted this play() call; that load reports its own outcome.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setStatus((current) =>
          current === 'error' ||
          (cause instanceof DOMException && cause.name === 'NotSupportedError')
            ? 'error'
            : 'blocked',
        );
      },
    );
  };
  // Mounted once per clip key (see `key` below), so this autoplays exactly once per observation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(play, []);
  const fragment = `#t=${view.startS}${view.endS != null ? `,${view.endS}` : ''}`;
  return (
    <div className="ra-road-recorded" data-road-view="recorded">
      <video
        ref={ref}
        muted
        playsInline
        controls
        autoPlay
        preload="auto"
        aria-label={`${view.label}: recorded road clip`}
        src={`${withDemoKey(view.src)}${fragment}`}
        onLoadedMetadata={(event) => {
          if (event.currentTarget.currentTime < view.startS)
            event.currentTarget.currentTime = view.startS;
        }}
        onPlaying={() => setStatus('playing')}
        onTimeUpdate={(event) => {
          if (view.endS != null && event.currentTarget.currentTime >= view.endS) {
            event.currentTarget.pause();
            setStatus('ended');
          }
        }}
        onError={() => setStatus('error')}
      />
      {status === 'error' && (
        <p className="ra-road-error" role="status">
          Clip failed to load. The recording may have expired or need access.
        </p>
      )}
      {status === 'blocked' && (
        <button className="ra-road-action" onClick={play}>
          Tap to play recorded clip
        </button>
      )}
      {status === 'ended' && (
        <button className="ra-road-action" onClick={play}>
          Replay clip
        </button>
      )}
      <span
        className="ra-feed-provenance"
        title={view.label + ' · ' + view.verdictLabel}
        data-road-label
      >
        {view.label.replace('Recorded footage', 'Recorded')}
      </span>
    </div>
  );
}

export default function VideoWidget({
  roadView,
  collapsed,
  onToggleCollapsed,
  onInference,
  toolsTarget,
}: {
  roadView: RoadView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onInference: (value: CameraInference | null) => void;
  toolsTarget?: HTMLElement | null;
}) {
  const camera = useCamera();
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
  const local = camera.status === 'live' || camera.status === 'starting';
  const stopCamera = () => {
    setAnalysing(false);
    camera.stop();
    onInference(null);
  };
  return (
    <section
      className={['ra-video-widget', `is-${roadView.kind}`, collapsed && 'is-collapsed']
        .filter(Boolean)
        .join(' ')}
      aria-label="Road video overlay"
      data-map-chrome
    >
      <div className="ra-feed-controls">
        {local && !collapsed && (
          <button aria-label="Stop camera" onClick={stopCamera}>
            <X size={14} />
          </button>
        )}
        <button
          className={collapsed ? 'ra-glass' : ''}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show road view' : 'Minimise road view'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <Video size={20} /> : <Minimize2 size={15} />}
        </button>
      </div>
      {/* The camera element stays mounted so an active preview survives collapsing. */}
      <video
        ref={camera.videoRef}
        hidden={!local || collapsed}
        muted
        playsInline
        aria-label="Local camera preview"
      />
      <canvas ref={canvasRef} hidden />
      {!collapsed && !local && roadView.kind === 'recorded' && (
        <RecordedClip key={roadView.key} view={roadView} />
      )}
      {!collapsed && !local && roadView.kind === 'synthetic' && (
        <div className="ra-road-synthetic" data-road-view="synthetic">
          <span className="ra-synthetic-chip">
            <FlaskConical size={12} aria-hidden="true" />
            SYNTHETIC
          </span>
          <strong data-road-label>{roadView.label}</strong>
          <span>{roadView.detail}</span>
        </div>
      )}
      {!collapsed && !local && roadView.kind === 'unavailable' && (
        <div className="ra-video-placeholder" data-road-view="unavailable">
          <Camera size={18} aria-hidden="true" />
          <strong>{roadView.label}</strong>
        </div>
      )}
      {!collapsed && local && roadView.kind === 'recorded' && (
        <button className="ra-enable-camera" onClick={stopCamera}>
          <Video size={11} />
          Recorded clip ready
        </button>
      )}
      {!collapsed && !local && (
        <button className="ra-enable-camera" onClick={() => void camera.start()}>
          <Camera size={11} />
          Use camera
        </button>
      )}
      {toolsTarget &&
        createPortal(
          <div className="ra-camera-tools">
            <button onClick={() => (local ? stopCamera() : void camera.start())}>
              <Camera size={15} />
              {local ? 'Stop camera' : 'Use camera'}
            </button>
            <button
              disabled={camera.status !== 'live'}
              onClick={() => {
                setAnalysing(!analysing);
                if (analysing) onInference(null);
              }}
            >
              {analysing ? 'Pause analysis' : 'Analyse live'}
            </button>
            <p className="ra-subtle">
              {analysing
                ? 'Sending frames to the analysis server'
                : local
                  ? 'Local preview · not analysed'
                  : 'Camera starts only when you choose it.'}
            </p>
          </div>,
          toolsTarget,
        )}
      {camera.error && (
        <p className="ra-camera-error" role="alert">
          Camera unavailable. Check browser permissions.
        </p>
      )}
    </section>
  );
}
