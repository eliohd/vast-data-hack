import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bike,
  Play,
  Pause,
  RotateCcw,
  Route,
  X,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  Navigation,
  Signal,
  BatteryFull,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewAt, previewFrames } from '@/lib/rideahead/preview';
import { timeLabel, type RideAheadConnection, type SnapshotView } from '@/lib/rideahead/view';
import NavigationMap from './NavigationMap';
import VideoWidget, { type CameraInference } from './VideoWidget';
import EvidencePanel from './EvidencePanel';
import '@/styles/rideahead.css';

const actionLabels = {
  continue: 'Continue your ride',
  heads_up: 'Heads up ahead',
  slow: 'Slow down',
  wait: 'Wait before continuing',
  reroute: 'Take the alternative',
  unavailable: 'Recommendation unavailable',
};

export default function RideAhead({ connection }: { connection?: RideAheadConnection }) {
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(connection ? null : previewAt(0));
  const [playing, setPlaying] = useState(false);
  const [cameraInference, setCameraInference] = useState<CameraInference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHazard, setSelectedHazard] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [configDraft, setConfigDraft] = useState<SnapshotView['config'] | null>(null);
  const locked = useRef(false);
  const current = useRef(snapshot);
  const isPlaying = useRef(playing);
  useEffect(() => {
    isPlaying.current = playing;
  }, [playing]);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);

  const request = useCallback(async (operation: () => Promise<SnapshotView>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const next = await operation();
      current.current = next;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : 'The session could not be updated.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    void request(() => connection.read(controller.signal));
    const poll = window.setInterval(() => {
      if (!isPlaying.current) void request(() => connection.read(controller.signal));
    }, 2500);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [connection, request]);

  const advance = useCallback(
    (timeS: number) => {
      if (connection) void request(() => connection.advance(timeS));
      else setSnapshot(previewAt(timeS));
    },
    [connection, request],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const value = current.current;
      if (!value || value.timeS >= value.endS) {
        setPlaying(false);
        return;
      }
      advance(
        connection
          ? Math.min(value.timeS + 5, value.endS)
          : (previewFrames.find((frame) => frame.timeS > value.timeS)?.timeS ?? value.endS),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, advance, connection]);

  const panelRef = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<'replay' | 'evidence' | 'settings' | 'routes'>('replay');
  const openPanel = (name: typeof panel) => {
    setPanel(name);
    panelRef.current?.showModal();
  };
  const selected = snapshot?.decision;
  const config = configDraft ?? snapshot?.config;
  const route = snapshot?.routes.find((item) => item.id === selected?.selectedRouteId);
  const latestEvidence = snapshot?.evidence.at(-1);
  const cosmos = snapshot?.cosmos;
  const cosmosLabel = {
    live_model: 'Live model result',
    cached_model: 'Cached result',
    fixture: 'Fixture · no live inference',
    unavailable: 'Waiting for inference',
  };

  return (
    <main className="ra-phone-stage">
      <div className="ra-phone-device">
        <div className="ra-phone-screen">
          <div className="ra-phone-status" aria-hidden="true">
            <span>RideAhead</span>
            <i className="ra-phone-island" />
            <span>
              <Signal size={13} />
              <BatteryFull size={18} />
            </span>
          </div>
          <header className="ra-phone-header">
            <div className="ra-phone-wordmark">
              <Bike size={21} />
              RideAhead<span>.</span>
            </div>
            <button aria-label="Open ride settings" onClick={() => openPanel('settings')}>
              <SlidersHorizontal size={18} />
            </button>
          </header>
          <section className="ra-navigation" aria-label="Cycling navigation">
            {snapshot ? (
              <NavigationMap
                snapshot={snapshot}
                onSelect={(id) => {
                  setSelectedHazard(id);
                  openPanel('evidence');
                }}
              />
            ) : (
              <div className="ra-map-loading">
                <Navigation size={32} />
                <p>{error ? 'Route unavailable' : 'Connecting to your ride…'}</p>
                {error && (
                  <button
                    onClick={() => connection && void request(() => connection.read())}
                    disabled={busy}
                  >
                    Retry connection
                  </button>
                )}
              </div>
            )}
            <div className="ra-navigation-instruction">
              <span className="ra-direction-icon">
                <Navigation size={23} />
              </span>
              <div>
                <strong>
                  {selected ? actionLabels[selected.action] : 'Your shared road ahead'}
                </strong>
                <span>{selected?.reason ?? 'Waiting for a route recommendation'}</span>
              </div>
            </div>
            <VideoWidget evidence={latestEvidence} onInference={setCameraInference} />
            <button
              className="ra-map-layer"
              aria-label="Show route alternatives"
              onClick={() => openPanel('routes')}
            >
              <Route size={18} />
            </button>
            <span className="ra-phone-provenance">
              {connection ? 'Session replay' : 'Synthetic fixture'} ·{' '}
              {snapshot ? timeLabel(snapshot.timeS) : 'connecting'}
            </span>
            {error && snapshot && (
              <span className="ra-phone-update-error" role="alert">
                Connection lost · last snapshot shown
              </span>
            )}
          </section>
          <button
            className="ra-journey-strip"
            aria-label="Estimated journey time and route options"
            onClick={() => openPanel('routes')}
          >
            <span className="ra-journey-time">
              <strong>{route?.durationS != null ? Math.ceil(route.durationS / 60) : '—'}</strong>
              <span>
                min<small>Estimated journey</small>
              </span>
            </span>
            <span className="ra-journey-distance">
              {route?.distanceM != null
                ? `${(route.distanceM / 1000).toFixed(1)} km`
                : 'Distance unknown'}
              <small>{route?.name ?? 'Route pending'}</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button
            className="ra-cosmos-strip"
            onClick={() => openPanel('evidence')}
            aria-label="Cosmos inference and evidence"
          >
            <span className="ra-cosmos-heading">
              <span>
                <Sparkles size={14} />
                {cameraInference && cameraInference.model !== 'cosmos' ? 'CAMERA MODEL' : 'COSMOS'}
              </span>
              <span
                className={
                  (cameraInference ? cameraInference.live : cosmos?.source === 'live_model')
                    ? 'ra-cosmos-live'
                    : ''
                }
              >
                {cameraInference?.label ?? cosmosLabel[cosmos?.source ?? 'unavailable']}
              </span>
            </span>
            <span className="ra-cosmos-text">
              {cameraInference?.text ??
                cosmos?.text ??
                'Waiting for a Cosmos observation of the road ahead.'}
            </span>
            <span className="ra-cosmos-footer">
              {cameraInference
                ? 'Camera stream · '
                : cosmos?.timeS != null
                  ? `Observed at ${timeLabel(cosmos.timeS)} · `
                  : ''}
              View evidence <ChevronRight size={11} />
            </span>
          </button>
          <nav className="ra-phone-toolbar" aria-label="Ride controls">
            <button
              disabled={!snapshot || busy || snapshot.timeS >= snapshot.endS}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {playing ? 'Pause' : 'Play replay'}
            </button>
            <button onClick={() => openPanel('replay')}>
              <RotateCcw size={15} />
              Timeline
            </button>
            <a href="/live">
              Live tools <ChevronRight size={12} />
            </a>
          </nav>
          <div className="ra-home-indicator" aria-hidden="true" />
        </div>
      </div>
      <dialog ref={panelRef} className="ra-phone-sheet">
        <div className="ra-sheet-header">
          <h2>
            {
              {
                replay: 'Replay timeline',
                evidence: 'Evidence & Cosmos',
                settings: 'Ride settings',
                routes: 'Journey & routes',
              }[panel]
            }
          </h2>
          <button aria-label="Close panel" onClick={() => panelRef.current?.close()}>
            <X size={21} />
          </button>
        </div>
        {error && (
          <div className="ra-error" role="alert">
            {error}
          </div>
        )}
        {panel === 'evidence' && cameraInference && (
          <section className="ra-panel">
            <h3>{cameraInference.model} camera output</h3>
            <p className="ra-subtle">{cameraInference.label}</p>
            <p>{cameraInference.text}</p>
          </section>
        )}
        {!snapshot ? (
          <p className="ra-empty">
            Connect a session, or choose the offline fixture in Demo controls.
          </p>
        ) : (
          <>
            <p className="ra-subtle">{snapshot.provenance}</p>
            {panel === 'replay' && (
              <section className="ra-replay" aria-label="Replay controls">
                <div className="ra-replay-top">
                  <p>
                    {timeLabel(snapshot.timeS)} / {timeLabel(snapshot.endS)}
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPlaying(false);
                      setDraftTime(null);
                      advance(0);
                    }}
                  >
                    <RotateCcw size={15} />
                    Reset
                  </Button>
                </div>
                <label htmlFor="ra-time">Replay time in seconds</label>
                <input
                  id="ra-time"
                  type="range"
                  min="0"
                  max={snapshot.endS}
                  step="1"
                  value={draftTime ?? snapshot.timeS}
                  disabled={busy}
                  onChange={(event) => {
                    setPlaying(false);
                    setDraftTime(Number(event.target.value));
                  }}
                />
                {draftTime !== null && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      advance(draftTime);
                      setDraftTime(null);
                    }}
                  >
                    Go to {timeLabel(draftTime)}
                  </Button>
                )}
                <p className="ra-subtle">
                  {connection
                    ? 'Replay advances the session clock. Reads never advance it.'
                    : 'Offline playback steps through canonical synthetic snapshots.'}
                </p>
                {!connection && (
                  <div className="ra-chapters">
                    {[
                      [0, 'Start'],
                      [60, 'Observed'],
                      [200, 'Bike B departs'],
                      [330, 'Stale'],
                      [450, 'Synthetic clearance'],
                    ].map(([time, label]) => (
                      <button
                        key={time}
                        onClick={() => {
                          setPlaying(false);
                          setDraftTime(null);
                          advance(Number(time));
                          panelRef.current?.close();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
            {panel === 'evidence' && (
              <EvidencePanel snapshot={snapshot} selectedHazard={selectedHazard} />
            )}
            {panel === 'routes' && (
              <section className="ra-panel">
                <h2>{selected ? actionLabels[selected.action] : 'No recommendation yet'}</h2>
                <p className="ra-subtle">{selected?.reason}</p>
                <div className="ra-routes">
                  {snapshot.routes.map((item) => (
                    <article
                      key={item.id}
                      className={selected?.selectedRouteId === item.id ? 'is-selected' : ''}
                    >
                      <h3>{item.name}</h3>
                      <p>
                        {item.durationS == null
                          ? 'Duration unknown'
                          : `${Math.ceil(item.durationS / 60)} min`}{' '}
                        ·{' '}
                        {item.distanceM == null
                          ? 'Distance unknown'
                          : `${(item.distanceM / 1000).toFixed(2)} km`}
                      </p>
                      <small>{item.provenance}</small>
                      {item.warnings.map((warning) => (
                        <p className="ra-route-warning" key={warning}>
                          {warning}
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
                <p className="ra-subtle">
                  Journey time is the route provider’s whole-route estimate, not a countdown to
                  arrival.
                </p>
                <p className="ra-subtle">
                  Estimated obstruction delay:{' '}
                  {selected?.delayS == null ? 'unknown' : `${selected.delayS}s`} · Detour:{' '}
                  {selected?.detourS == null ? 'unknown' : `${selected.detourS}s`}
                </p>
                {selected?.assumptions.map((assumption) => (
                  <p className="ra-subtle" key={assumption}>
                    {assumption}
                  </p>
                ))}
              </section>
            )}
            {panel === 'settings' && (
              <section className="ra-panel">
                <h2>Sharing & planning</h2>
                {config && (
                  <>
                    {(['shortRadiusM', 'planningRadiusM'] as const).map((name) => (
                      <label className="ra-slider-label" key={name}>
                        {name === 'shortRadiusM' ? 'Nearby reports' : 'Planning area'}
                        <strong>{config[name]} m</strong>
                        <input
                          type="range"
                          min={name === 'shortRadiusM' ? 50 : 500}
                          max={Math.max(config[name], name === 'shortRadiusM' ? 1000 : 5000)}
                          step="50"
                          value={config[name]}
                          disabled={busy}
                          onChange={(event) =>
                            setConfigDraft({ ...config, [name]: Number(event.target.value) })
                          }
                        />
                      </label>
                    ))}
                    {configDraft && (
                      <>
                        <p className="ra-subtle">
                          {connection
                            ? 'Unsaved settings'
                            : 'Preview draft only · requires server to apply'}
                        </p>
                        <Button
                          disabled={busy || !connection}
                          onClick={() => {
                            if (connection)
                              void request(async () => {
                                const next = await connection.configure(configDraft);
                                setConfigDraft(null);
                                return next;
                              });
                          }}
                        >
                          Apply settings
                        </Button>
                        <Button variant="ghost" onClick={() => setConfigDraft(null)}>
                          Discard
                        </Button>
                      </>
                    )}
                  </>
                )}
                <h3>Connections</h3>
                <div className="ra-integration-grid">
                  {snapshot.integrations.map((item) => (
                    <article key={item.name}>
                      <strong>{item.name}</strong>
                      <span className="ra-tag">{item.status}</span>
                      <p>{item.detail}</p>
                    </article>
                  ))}
                </div>
                <p className="ra-subtle">{snapshot.locationLabel}</p>
              </section>
            )}
          </>
        )}
      </dialog>
    </main>
  );
}
