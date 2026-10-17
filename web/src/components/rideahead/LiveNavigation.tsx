import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { BotAvatar } from 'bot-avatars';
import {
  AlertTriangle,
  ArrowUp,
  Crosshair,
  Flag,
  LocateFixed,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { BoxOverlay } from '@/components/camera/BoxOverlay';
import { useCamera } from '@/hooks/useCamera';
import { useWakeLock } from '@/hooks/useWakeLock';
import { withDemoKey } from '@/lib/demoKey';
import { captureJpeg } from '@/lib/frames';
import {
  distanceToRouteM,
  formatDistance,
  geocodeUrl,
  haversineM,
  nextStepIndex,
  parsePlaces,
  parseRoutes,
  pickDetour,
  pointAhead,
  routeUrl,
  type LatLon,
  type NavRoute,
  type Place,
} from '@/lib/liveNav';
import type { Box, ServerMessage } from '@/lib/protocol';
import {
  adviceLabels,
  displayed,
  shouldAnnounce,
  warningFrom,
  type RideAdvice,
  type RideWarning,
} from '@/lib/ride';
import { LiveSocket } from '@/lib/socket';
import 'leaflet/dist/leaflet.css';

type Phase = 'locating' | 'choose' | 'preview' | 'riding';
type MapRuntime = {
  L: typeof Leaflet;
  map: Leaflet.Map;
  route: Leaflet.LayerGroup;
  marks: Leaflet.LayerGroup;
  me: Leaflet.CircleMarker | null;
};

const FRAME_INTERVAL_MS = 1000;
const IN_FLIGHT_TIMEOUT_MS = 5000;
const OFF_ROUTE_M = 45;
const REROUTE_COOLDOWN_MS = 15000;

const tone: Record<RideAdvice, { bubble: string; mascot: string }> = {
  continue: { bubble: 'ra-live-bubble', mascot: '#9cbb68' },
  heads_up: { bubble: 'ra-live-bubble is-heads-up', mascot: '#e8b33a' },
  slow: { bubble: 'ra-live-bubble is-slow', mascot: '#ef7b32' },
  reroute: { bubble: 'ra-live-bubble is-reroute', mascot: '#e04848' },
};

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    synth.speak(utterance);
  } catch {
    // speech is a nicety; the bubble is the source of truth
  }
}

async function fetchRoutes(from: LatLon, to: LatLon): Promise<NavRoute[]> {
  const res = await fetch(routeUrl(from, to), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Bike routing failed (${res.status})`);
  return parseRoutes(await res.json());
}

/**
 * Live mode of the main app: your GPS on the map, a destination search, an OSM bike route with
 * turn-by-turn guidance, and Clover watching the rear camera (/ws/ride) for hazards on the way.
 */
export default function LiveNavigation({ onExit }: { onExit: () => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<MapRuntime | null>(null);
  const following = useRef(true);
  const [mapReady, setMapReady] = useState(false);

  const [phase, setPhase] = useState<Phase>('locating');
  const [position, setPosition] = useState<LatLon | null>(null);
  const positionRef = useRef<LatLon | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<Place | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const routeRef = useRef<NavRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [stepIndex, setStepIndex] = useState(1);
  const lastRerouteAt = useRef(0);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [hazards, setHazards] = useState<(LatLon & { message: string })[]>([]);

  const camera = useCamera();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef<{ seq: number; sentAt: number } | null>(null);
  const announcedRef = useRef<RideWarning | null>(null);
  const [latest, setLatest] = useState<RideWarning | null>(null);
  const [active, setActive] = useState<RideWarning | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [analyser, setAnalyser] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const riding = phase === 'riding';
  useWakeLock(riding);

  // -- map ---------------------------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !mapRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: false }).setView([51.5045, -0.1], 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        keepBuffer: 0,
        updateWhenIdle: true,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Routing: FOSSGIS OSRM',
      }).addTo(map);
      map.on('dragstart', () => {
        following.current = false;
      });
      runtime.current = {
        L,
        map,
        route: L.layerGroup().addTo(map),
        marks: L.layerGroup().addTo(map),
        me: null,
      };
      setMapReady(true);
    });
    return () => {
      disposed = true;
      runtime.current?.map.remove();
      runtime.current = null;
    };
  }, []);

  const followMe = useCallback((force = false) => {
    const state = runtime.current;
    const here = positionRef.current;
    if (!state || !here) return;
    if (force) following.current = true;
    if (!following.current) return;
    const { map, L } = state;
    const zoom = Math.max(map.getZoom(), 17);
    const ahead = map
      .project([here.lat, here.lon], zoom)
      .subtract(L.point(0, map.getSize().y * 0.18));
    map.setView(map.unproject(ahead, zoom), zoom, { animate: true, duration: 0.8 });
  }, []);

  // -- GPS ---------------------------------------------------------------------------------
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('This browser has no location access.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        positionRef.current = next;
        setPosition(next);
        setGpsError(null);
        setPhase((p) => (p === 'locating' ? 'choose' : p));
      },
      (err) =>
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked. Allow location for this site in Safari settings.'
            : 'Waiting for a GPS fix…',
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Draw "me" and keep the camera on the rider (except while previewing a whole route).
  useEffect(() => {
    const state = runtime.current;
    if (!mapReady || !state || !position) return;
    const ll: [number, number] = [position.lat, position.lon];
    if (!state.me)
      state.me = state.L.circleMarker(ll, {
        radius: 9,
        color: '#fff',
        weight: 3,
        fillColor: '#2f7de1',
        fillOpacity: 1,
      }).addTo(state.map);
    else state.me.setLatLng(ll);
    if (phase !== 'preview') followMe();
  }, [mapReady, position, phase, followMe]);

  // Draw route, destination and reported hazards.
  useEffect(() => {
    const state = runtime.current;
    if (!mapReady || !state) return;
    state.route.clearLayers();
    state.marks.clearLayers();
    if (route) {
      state.L.polyline(route.points, { color: '#fff', weight: 10, opacity: 0.9 }).addTo(
        state.route,
      );
      state.L.polyline(route.points, { color: '#307957', weight: 6 }).addTo(state.route);
    }
    if (destination)
      state.L.circleMarker([destination.lat, destination.lon], {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#264533',
        fillOpacity: 1,
      }).addTo(state.marks);
    for (const hazard of hazards)
      state.L.circleMarker([hazard.lat, hazard.lon], {
        radius: 9,
        color: '#fff',
        weight: 3,
        fillColor: '#e04848',
        fillOpacity: 1,
      })
        .bindTooltip(hazard.message)
        .addTo(state.marks);
  }, [mapReady, route, destination, hazards]);

  // -- destination + route ------------------------------------------------------------------
  const search = async () => {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    try {
      const res = await fetch(geocodeUrl(text, positionRef.current), {
        signal: AbortSignal.timeout(12000),
      });
      const found = parsePlaces(await res.json());
      setPlaces(found);
      if (!found.length) toast.error('No places found. Try a street, postcode or landmark.');
    } catch {
      toast.error('Place search is unavailable right now.');
    } finally {
      setSearching(false);
    }
  };

  const applyRoute = (next: NavRoute) => {
    routeRef.current = next;
    setRoute(next);
    setStepIndex(1);
  };

  const choose = async (place: Place) => {
    const here = positionRef.current;
    if (!here) return;
    setDestination(place);
    setPlaces([]);
    setRouting(true);
    try {
      const routes = await fetchRoutes(here, place);
      if (!routes.length) throw new Error('No bike route found to that place.');
      applyRoute(routes[0]);
      setRouteNote(null);
      setPhase('preview');
      const state = runtime.current;
      if (state)
        state.map.fitBounds(state.L.latLngBounds(routes[0].points), {
          paddingTopLeft: [30, 200],
          paddingBottomRight: [30, 230],
        });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Routing failed.');
      setDestination(null);
    } finally {
      setRouting(false);
    }
  };

  const reroute = useCallback(
    async (avoid: LatLon | null, reason: string) => {
      const here = positionRef.current;
      const current = routeRef.current;
      if (!here || !destination || !current) return;
      if (Date.now() - lastRerouteAt.current < REROUTE_COOLDOWN_MS) return;
      lastRerouteAt.current = Date.now();
      try {
        const routes = await fetchRoutes(here, destination);
        if (!routes.length) return;
        if (!avoid) {
          applyRoute(routes[0]);
          setRouteNote('Back on track: route updated from where you are');
          return;
        }
        const detour = pickDetour(routes, avoid);
        if (detour) {
          applyRoute(detour);
          setRouteNote(`Rerouted around ${reason}`);
          speak(`Rerouting around ${reason}`);
        } else {
          setRouteNote(`No safe alternative around ${reason}. Slow down and pass with care.`);
        }
      } catch {
        setRouteNote('Could not reach the routing service. Keep to the current route.');
      }
    },
    [destination],
  );

  const stopCamera = camera.stop;
  const end = useCallback(() => {
    stopCamera();
    window.speechSynthesis?.cancel();
    setPhase('choose');
    setRoute(null);
    routeRef.current = null;
    setDestination(null);
    setActive(null);
    setLatest(null);
    setRouteNote(null);
    announcedRef.current = null;
    followMe(true);
  }, [stopCamera, followMe]);

  // Progress, arrival and off-route recovery on every GPS fix while riding.
  useEffect(() => {
    const current = routeRef.current;
    if (!riding || !position || !current) return;
    setStepIndex((index) => nextStepIndex(current.steps, position, index));
    if (destination && haversineM(position, destination) < 25) {
      toast.success(`Arrived at ${destination.name}`);
      end();
      speak('You have arrived');
      return;
    }
    if (distanceToRouteM(current.points, position) > OFF_ROUTE_M) void reroute(null, 'off route');
  }, [riding, position, destination, reroute, end]);

  const step = route?.steps[Math.min(stepIndex, route.steps.length - 1)];
  const stepDistance = step && position ? haversineM(position, step.location) : null;
  useEffect(() => {
    if (riding && step) speak(step.instruction);
    // Speak each new manoeuvre once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riding, step?.instruction, stepIndex]);

  // -- camera + Clover ----------------------------------------------------------------------
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === 'hello') setAnalyser(message.analyser);
      if (message.type === 'error') inFlightRef.current = null;
      if (message.type !== 'result') return;
      if (inFlightRef.current?.seq === message.seq) inFlightRef.current = null;
      setBoxes(message.boxes);
      const warning = warningFrom(message.data, message.capturedAt);
      if (!warning) return;
      setLatest(warning);
      if (warning.advice === 'continue') return;
      setActive(warning);
      if (!shouldAnnounce(announcedRef.current, warning)) return;
      announcedRef.current = warning;
      speak(warning.message);
      navigator.vibrate?.(warning.advice === 'heads_up' ? 150 : [200, 100, 200]);
      const here = positionRef.current;
      const current = routeRef.current;
      if (here) {
        const spot = current ? pointAhead(current.points, here) : here;
        setHazards((list) => [...list, { ...spot, message: warning.message }].slice(-20));
        if (warning.advice === 'reroute')
          void reroute(spot, warning.hazard.replace('_', ' ') || 'a hazard');
      }
    },
    [reroute],
  );

  useEffect(() => {
    if (!riding) return;
    const socket = new LiveSocket({ path: withDemoKey('/ws/ride'), onMessage, onState: () => {} });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [riding, onMessage]);

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
    if (socket.send({ type: 'frame', seq, capturedAt, ...frame }))
      inFlightRef.current = { seq, sentAt: capturedAt };
  }, [camera.videoRef]);

  useEffect(() => {
    if (!riding) return;
    const id = window.setInterval(() => {
      if (camera.status === 'live') sendFrame();
      setNow(Date.now());
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [riding, camera.status, sendFrame]);

  const start = async () => {
    speak('Clover here. Let’s ride.'); // iOS only speaks after a tap
    following.current = true;
    setPhase('riding');
    await camera.start();
  };

  const exit = () => {
    camera.stop();
    window.speechSynthesis?.cancel();
    onExit();
  };

  // -- UI ----------------------------------------------------------------------------------
  const shown = riding ? displayed(active, latest, now) : null;
  const warningShown = shown && shown.advice !== 'continue' ? shown : null;
  const advice: RideAdvice = warningShown?.advice ?? 'continue';
  // Remaining = rider → next manoeuvre + the step distances after it.
  const remainingM = route
    ? (stepDistance ?? 0) +
      route.steps.slice(stepIndex).reduce((sum, item) => sum + item.distanceM, 0)
    : 0;
  const etaS = route && route.distanceM > 0 ? (route.durationS * remainingM) / route.distanceM : 0;

  return (
    <main className="ra-live">
      <div ref={mapRef} className="ra-live-map" aria-label="Live map" />

      <header className="ra-live-top">
        <div className="ra-phone-wordmark">
          Cysense<span>.</span>
        </div>
        <span className="ra-live-chip">● LIVE</span>
        <button className="ra-glass ra-live-exit" onClick={exit} aria-label="Leave live mode">
          <X size={18} />
        </button>
      </header>

      <div className="ra-live-guide">
        <BotAvatar
          type="clover"
          color={tone[advice].mascot}
          size={60}
          state={riding && inFlightRef.current ? 'working' : 'default'}
          interactive={false}
          theme="light"
        />
        <div className={tone[advice].bubble} aria-live="assertive">
          {warningShown ? (
            <>
              <span className="ra-live-eyebrow">
                <AlertTriangle size={12} /> {adviceLabels[warningShown.advice]}
              </span>
              <strong>{warningShown.message}</strong>
            </>
          ) : riding && step ? (
            <>
              <span className="ra-live-eyebrow">
                {step.instruction.startsWith('Arrive') ? <Flag size={12} /> : <ArrowUp size={12} />}
                {stepDistance != null ? `In ${formatDistance(stepDistance)}` : 'Next'}
              </span>
              <strong>{step.instruction}</strong>
            </>
          ) : phase === 'locating' ? (
            <>
              <span className="ra-live-eyebrow">Clover · live</span>
              <strong>{gpsError ?? 'Finding where you are…'}</strong>
            </>
          ) : phase === 'preview' && route ? (
            <>
              <span className="ra-live-eyebrow">Route ready</span>
              <strong>
                {formatDistance(route.distanceM)} · {Math.ceil(route.durationS / 60)} min by bike
              </strong>
            </>
          ) : (
            <>
              <span className="ra-live-eyebrow">Clover · live</span>
              <strong>Where are we riding?</strong>
            </>
          )}
          {routeNote && riding && (
            <span className="ra-live-note">
              <RefreshCw size={11} /> {routeNote}
            </span>
          )}
        </div>
      </div>

      {phase === 'choose' && (
        <section className="ra-live-search">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a place, street or postcode"
              enterKeyHint="search"
              autoComplete="off"
            />
            <button type="submit" disabled={searching || !query.trim()}>
              {searching ? '…' : 'Go'}
            </button>
          </form>
          {(places.length > 0 || routing) && (
            <ul>
              {routing && <li className="ra-live-muted">Finding a bike route…</li>}
              {places.map((place) => (
                <li key={`${place.lat},${place.lon}`}>
                  <button onClick={() => void choose(place)} disabled={routing}>
                    <strong>{place.name}</strong>
                    <span>
                      {place.detail}
                      {position && ` · ${formatDistance(haversineM(position, place))}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="ra-live-tools">
        <button
          className="ra-glass"
          aria-label="Follow my location"
          onClick={() => followMe(true)}
          disabled={!position}
        >
          {following.current ? <LocateFixed size={19} /> : <Crosshair size={19} />}
        </button>
      </div>

      {riding && (
        <div className="ra-live-camera">
          <video ref={camera.videoRef} autoPlay playsInline muted />
          <BoxOverlay boxes={boxes} frame={frameSize} />
          <span>{camera.status === 'live' ? (analyser ?? 'connecting') : camera.status}</span>
        </div>
      )}
      <canvas ref={canvasRef} hidden />

      {phase === 'preview' && route && destination && (
        <section className="ra-live-sheet">
          <p className="ra-live-dest">To {destination.name}</p>
          <div className="ra-live-stats">
            <div>
              <strong>{Math.ceil(route.durationS / 60)} min</strong>
              <span>by bike</span>
            </div>
            <div>
              <strong>{formatDistance(route.distanceM)}</strong>
              <span>distance</span>
            </div>
          </div>
          <div className="ra-live-actions">
            <button className="ra-live-primary" onClick={() => void start()}>
              Start route
            </button>
            <button onClick={end}>Change</button>
          </div>
          <p className="ra-live-muted">
            Starts the rear camera: Clover warns you about hazards and reroutes around blocked
            roads.
          </p>
        </section>
      )}

      {riding && route && (
        <section className="ra-live-sheet">
          <div className="ra-live-stats">
            <div>
              <strong>{Math.max(1, Math.ceil(etaS / 60))} min</strong>
              <span>remaining</span>
            </div>
            <div>
              <strong>{formatDistance(remainingM)}</strong>
              <span>distance left</span>
            </div>
            <div>
              <strong>{hazards.length}</strong>
              <span>hazards</span>
            </div>
          </div>
          <div className="ra-live-actions">
            <button className="ra-live-end" onClick={end}>
              End route
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
