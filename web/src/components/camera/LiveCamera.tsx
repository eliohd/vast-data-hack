import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Circle, RefreshCw, Send, SwitchCamera } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCamera } from '@/hooks/useCamera';
import { useClipRecorder } from '@/hooks/useClipRecorder';
import { useWakeLock } from '@/hooks/useWakeLock';
import { demoKeyHeaders, withDemoKey } from '@/lib/demoKey';
import { captureJpeg } from '@/lib/frames';
import type { Box, ServerMessage, ServerResult } from '@/lib/protocol';
import { LiveSocket, type SocketState } from '@/lib/socket';
import { BoxOverlay } from './BoxOverlay';

const INTERVALS_MS = [500, 1000, 2000] as const;
/** Give up waiting for a reply after this long and send the next frame anyway. */
const IN_FLIGHT_TIMEOUT_MS = 5000;

export default function LiveCamera() {
  const camera = useCamera();
  const recorder = useClipRecorder();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef<{ seq: number; sentAt: number } | null>(null);

  const [socketState, setSocketState] = useState<SocketState>('closed');
  const [analyser, setAnalyser] = useState<string>('—');
  const [streaming, setStreaming] = useState(false);
  const [intervalMs, setIntervalMs] = useState<number>(1000);
  const [prompt, setPrompt] = useState('');
  const [latest, setLatest] = useState<ServerResult | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [ingestClips, setIngestClips] = useState(false);

  useWakeLock(camera.status === 'live');

  const onMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'hello':
        setAnalyser(message.analyser);
        break;
      case 'result':
        if (inFlightRef.current?.seq === message.seq) inFlightRef.current = null;
        setLatest(message);
        setBoxes(message.boxes);
        setRoundTripMs(Date.now() - message.capturedAt);
        break;
      case 'error':
        inFlightRef.current = null;
        toast.error(message.message);
        break;
      case 'pong':
        break;
    }
  }, []);

  useEffect(() => {
    const socket = new LiveSocket({
      path: withDemoKey('/ws/live'),
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

    // Backpressure: one frame in flight at a time, so a slow model never builds a queue.
    const inFlight = inFlightRef.current;
    if (inFlight && Date.now() - inFlight.sentAt < IN_FLIGHT_TIMEOUT_MS) return;

    const frame = captureJpeg(video, canvas);
    if (!frame) return;
    const seq = ++seqRef.current;
    const capturedAt = Date.now();
    setFrameSize({ width: frame.width, height: frame.height });
    if (
      socket.send({
        type: 'frame',
        seq,
        capturedAt,
        ...frame,
        prompt: prompt.trim() || undefined,
      })
    ) {
      inFlightRef.current = { seq, sentAt: capturedAt };
    }
  }, [camera.videoRef, prompt]);

  useEffect(() => {
    if (!streaming || camera.status !== 'live') return;
    const id = setInterval(sendFrame, intervalMs);
    return () => clearInterval(id);
  }, [streaming, camera.status, intervalMs, sendFrame]);

  const recordClip = useCallback(async () => {
    const stream = camera.streamRef.current;
    if (!stream) return;
    try {
      const clip = await recorder.record(stream, 10_000);
      const ext = clip.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const body = new FormData();
      body.append('file', clip.blob, `clip-${Date.now()}.${ext}`);
      body.append('ingest', String(ingestClips));
      const res = await fetch('/api/clips', { method: 'POST', body, headers: demoKeyHeaders() });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const saved = (await res.json()) as { filename: string; ingested: boolean };
      toast.success(`Saved ${saved.filename}${saved.ingested ? ' and sent to VSS' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [camera.streamRef, ingestClips, recorder]);

  const live = camera.status === 'live';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="relative aspect-[3/4] bg-black sm:aspect-video">
          <video
            ref={camera.videoRef}
            className="absolute inset-0 size-full object-contain"
            autoPlay
            playsInline
            muted
          />
          <BoxOverlay boxes={boxes} frame={frameSize} />
          {!live && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">
              {camera.status === 'error'
                ? camera.error
                : 'Tap “Start camera”. Needs HTTPS on a phone.'}
            </div>
          )}
          <div className="absolute top-3 left-3 flex flex-wrap gap-2">
            <Badge variant={socketState === 'open' ? 'default' : 'destructive'}>
              {socketState}
            </Badge>
            <Badge variant="secondary">{analyser}</Badge>
            {roundTripMs !== null && <Badge variant="secondary">{roundTripMs} ms</Badge>}
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <CardContent className="flex flex-wrap items-center gap-2 pt-4">
          {live ? (
            <Button variant="secondary" onClick={camera.stop}>
              <CameraOff /> Stop
            </Button>
          ) : (
            <Button onClick={() => void camera.start()}>
              <Camera /> Start camera
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => void camera.flip()} disabled={!live}>
            <SwitchCamera />
          </Button>
          <Button
            variant={streaming ? 'destructive' : 'default'}
            onClick={() => setStreaming((s) => !s)}
            disabled={!live}
          >
            <RefreshCw /> {streaming ? 'Pause analysis' : 'Analyse live'}
          </Button>
          <Button variant="outline" onClick={sendFrame} disabled={!live}>
            <Send /> One frame
          </Button>
          <div className="flex gap-1">
            {INTERVALS_MS.map((ms) => (
              <Button
                key={ms}
                size="sm"
                variant={ms === intervalMs ? 'secondary' : 'ghost'}
                onClick={() => setIntervalMs(ms)}
              >
                {ms / 1000}s
              </Button>
            ))}
          </div>
          <Input
            className="min-w-48 flex-1"
            placeholder="Optional question about the scene…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={recorder.recording ? recorder.stop : () => void recordClip()}
              disabled={!live}
            >
              <Circle className={recorder.recording ? 'fill-red-500 text-red-500' : ''} />
              {recorder.recording ? 'Stop clip' : 'Record 10s clip'}
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={ingestClips} onCheckedChange={setIngestClips} />
              Send to VSS
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest result</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {latest ? (
            <>
              <p className="text-base leading-relaxed">{latest.summary}</p>
              <p className="text-muted-foreground">
                frame #{latest.seq} · server {latest.processingMs} ms · {latest.boxes.length} boxes
              </p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(latest.data, null, 2)}
              </pre>
            </>
          ) : (
            <p className="text-muted-foreground">No frames analysed yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
