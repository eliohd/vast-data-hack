import { useCallback, useEffect, useRef, useState } from 'react';
import { BotAvatar } from 'bot-avatars';
import { AlertTriangle, ArrowUp, Bike, Gauge, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';

import { BoxOverlay } from '@/components/camera/BoxOverlay';
import { useCamera } from '@/hooks/useCamera';
import { useWakeLock } from '@/hooks/useWakeLock';
import { withDemoKey } from '@/lib/demoKey';
import { captureJpeg } from '@/lib/frames';
import type { Box, ServerMessage } from '@/lib/protocol';
import {
  adviceLabels,
  displayed,
  shouldAnnounce,
  warningFrom,
  type RideAdvice,
  type RideWarning,
} from '@/lib/ride';
import { LiveSocket, type SocketState } from '@/lib/socket';

const FRAME_INTERVAL_MS = 1000;
const IN_FLIGHT_TIMEOUT_MS = 5000;

const tone: Record<RideAdvice, { bubble: string; mascot: string }> = {
  continue: { bubble: 'bg-white/90 text-zinc-900', mascot: '#9cbb68' },
  heads_up: { bubble: 'bg-amber-300/95 text-zinc-950', mascot: '#e8b33a' },
  slow: { bubble: 'bg-orange-500/95 text-white', mascot: '#ef7b32' },
  reroute: { bubble: 'bg-red-600/95 text-white', mascot: '#e04848' },
};

interface Fix {
  lat: number;
  lon: number;
  speedKmh: number | null;
}

interface Spotted extends RideWarning {
  where: Fix | null;
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 1.05;
    synth.speak(u);
  } catch {
    // speech is a nicety; the bubble is the source of truth
  }
}

export default function LiveRide() {
  const camera = useCamera();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef<{ seq: number; sentAt: number } | null>(null);
  const announcedRef = useRef<RideWarning | null>(null);
  const fixRef = useRef<Fix | null>(null);

  const [socketState, setSocketState] = useState<SocketState>('closed');
  const [analyser, setAnalyser] = useState('—');
  const [riding, setRiding] = useState(false);
  const [latest, setLatest] = useState<RideWarning | null>(null);
  const [active, setActive] = useState<RideWarning | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [spotted, setSpotted] = useState<Spotted[]>([]);
  const [now, setNow] = useState(Date.now());

  useWakeLock(riding);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.type === 'hello') setAnalyser(message.analyser);
    if (message.type === 'error') {
      inFlightRef.current = null;
      toast.error(message.message);
    }
    if (message.type !== 'result') return;
    if (inFlightRef.current?.seq === message.seq) inFlightRef.current = null;
    setLatencyMs(Date.now() - message.capturedAt);
    setBoxes(message.boxes);
    const warning = warningFrom(message.data, message.capturedAt);
    if (!warning) return;
    setLatest(warning);
    if (warning.advice === 'continue') return;
    setActive(warning);
    if (shouldAnnounce(announcedRef.current, warning)) {
      announcedRef.current = warning;
      speak(warning.message);
      navigator.vibrate?.(warning.advice === 'heads_up' ? 150 : [200, 100, 200]);
      setSpotted((list) => [{ ...warning, where: fixRef.current }, ...list].slice(0, 20));
    }
  }, []);

  useEffect(() => {
    const socket = new LiveSocket({
      path: withDemoKey('/ws/ride'),
      onMessage,
      onState: setSocketState,
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
  }, [onMessage]);

  const sendFrame = useCallback(() => {
    const socket = socketRef.current;
    const video = camera.videoRef.current;
    const canvas = canvasRef.current;
    if (!socket?.ready || !video || !canvas) return;
    const inFlight = inFlightRef.current;
    if (inFlight && Date.now() - inFlight.sentAt < IN_FLIGHT_TIMEOUT_MS) return;
    const frame = captureJpeg(video, canvas);
    if (!frame) return;
    const seq = ++seqRef.current;
    const capturedAt = Date.now();
    setFrameSize({ width: frame.width, height: frame.height });
    if (socket.send({ type: 'frame', seq, capturedAt, ...frame })) {
      inFlightRef.current = { seq, sentAt: capturedAt };
    }
  }, [camera.videoRef]);

  useEffect(() => {
    if (!riding || camera.status !== 'live') return;
    const id = setInterval(() => {
      sendFrame();
      setNow(Date.now());
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [riding, camera.status, sendFrame]);

  useEffect(() => {
    if (!riding || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          speedKmh: pos.coords.speed == null ? null : pos.coords.speed * 3.6,
        };
        fixRef.current = next;
        setFix(next);
      },
      () => toast.error('No GPS: warnings still work, hazards are logged without a location'),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [riding]);

  const start = async () => {
    speak('Clover here. Riding with you.'); // iOS only speaks after a tap
    await camera.start();
    setRiding(true);
  };

  const stop = () => {
    setRiding(false);
    camera.stop();
    window.speechSynthesis?.cancel();
  };

  const shown = displayed(active, latest, now);
  const advice: RideAdvice = shown?.advice ?? 'continue';
  const Icon = advice === 'reroute' ? RefreshCw : advice === 'continue' ? ArrowUp : AlertTriangle;
  const live = camera.status === 'live';

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <video
        ref={camera.videoRef}
        className="absolute inset-0 size-full object-cover"
        autoPlay
        playsInline
        muted
      />
      <BoxOverlay boxes={boxes} frame={frameSize} />
      <canvas ref={canvasRef} className="hidden" />

      <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs">
        <span className="flex items-center gap-1 font-semibold">
          <Bike size={14} /> Cysense · ride live
        </span>
        <span
          className={`rounded-full px-2 py-0.5 ${socketState === 'open' ? 'bg-emerald-600' : 'bg-red-600'}`}
        >
          {socketState}
        </span>
        <span className="rounded-full bg-white/20 px-2 py-0.5">{analyser}</span>
        {latencyMs !== null && (
          <span className="rounded-full bg-white/20 px-2 py-0.5">{latencyMs} ms</span>
        )}
        {fix && (
          <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5">
            <Gauge size={12} />
            {fix.speedKmh == null ? 'GPS ok' : `${Math.round(fix.speedKmh)} km/h`}
          </span>
        )}
        {spotted.length > 0 && (
          <span className="rounded-full bg-white/20 px-2 py-0.5">{spotted.length} spotted</span>
        )}
      </div>

      {!live && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-xs space-y-4">
            <BotAvatar type="clover" color="#9cbb68" size={96} interactive={false} theme="dark" />
            <p className="text-lg font-semibold">Clover rides with you</p>
            <p className="text-sm text-white/70">
              Mount the phone on the handlebars, rear camera facing the road. Clover watches every
              second and speaks up about blocked lanes, roadworks, doors and close vehicles.
            </p>
            {camera.status === 'error' && <p className="text-sm text-red-300">{camera.error}</p>}
            <button
              className="w-full rounded-full bg-[#9cbb68] px-6 py-3 text-base font-semibold text-zinc-950"
              onClick={() => void start()}
            >
              Start riding
            </button>
          </div>
        </div>
      )}

      {live && (
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="shrink-0">
            <BotAvatar
              type="clover"
              color={tone[advice].mascot}
              size={72}
              state={inFlightRef.current ? 'working' : 'default'}
              interactive={false}
              theme="dark"
            />
          </div>
          <div
            className={`min-w-0 flex-1 rounded-2xl px-4 py-3 shadow-lg ${tone[advice].bubble}`}
            aria-live="assertive"
          >
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase opacity-80">
              <Icon size={14} />
              {adviceLabels[advice]}
              {shown && shown.hazard !== 'none' && ` · ${shown.hazard.replace('_', ' ')}`}
            </div>
            <p className="mt-1 text-lg leading-snug font-semibold">
              {shown?.message ?? 'Watching the road…'}
            </p>
            {advice === 'reroute' && (
              <p className="mt-1 text-sm opacity-90">
                Path ahead blocked: take the next safe turn.
              </p>
            )}
          </div>
          <button
            className="shrink-0 rounded-full bg-white/20 p-3"
            onClick={stop}
            aria-label="Stop riding"
          >
            <Square size={18} />
          </button>
        </div>
      )}
    </main>
  );
}
