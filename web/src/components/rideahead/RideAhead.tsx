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
  RefreshCw,
  FlaskConical,
  Signal,
  BatteryFull,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  decisionKey,
  formatArrival,
  formatDelay,
  formatDetour,
  initialDecisionTracker,
  trackDecisionChange,
  type DecisionChange,
} from '@/lib/rideahead/decisionChange';
import { previewAt, previewChapters, previewFrames } from '@/lib/rideahead/preview';
import { roadViewFor, type RoadView } from '@/lib/rideahead/roadView';
import { isValidPoint } from '@/lib/rideahead/projection';
import {
  actionLabels,
  timeLabel,
  type RideAheadConnection,
  type SnapshotView,
} from '@/lib/rideahead/view';
import NavigationMap from './NavigationMap';
import MapLegend from './MapLegend';
import VideoWidget, { type CameraInference } from './VideoWidget';
import EvidencePanel from './EvidencePanel';
import '@/styles/rideahead.css';

const noRoadView: RoadView = {
  kind: 'unavailable',
  key: null,
  label: 'No recorded clip for this moment',
  detail: 'Waiting for the session.',
};
const HIGHLIGHT_MS = 1600;

export default function RideAhead({ connection }: { connection?: RideAheadConnection }) {
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(connection ? null : previewAt(0));
  const [playing, setPlaying] = useState(false);
  const [cameraInference, setCameraInference] = useState<CameraInference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHazard, setSelectedHazard] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [configDraft, setConfigDraft] = useState<SnapshotView['config'] | null>(null);
  const [applying, setApplying] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [overlayCollapsed, setOverlayCollapsed] = useState(false);
  const [announced, setAnnounced] = useState<DecisionChange | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [decisionLog, setDecisionLog] = useState<DecisionChange[]>([]);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const tracker = useRef(initialDecisionTracker);
  const current = useRef(snapshot);
  const isPlaying = useRef(playing);
  useEffect(() => {
    isPlaying.current = playing;
  }, [playing]);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);

  // Serialized server requests. Background polls and play ticks are dropped while another request
  // is pending; user actions queue behind it instead of being silently ignored.
  const request = useCallback(
    (operation: () => Promise<SnapshotView>, { drop = false }: { drop?: boolean } = {}) => {
      if (drop && pending.current > 0) return Promise.resolve(false);
      pending.current += 1;
      setBusy(true);
      const run = async () => {
        try {
          const next = await operation();
          current.current = next;
          setSnapshot(next);
          setError(null);
          return true;
        } catch (cause) {
          setPlaying(false);
          setError(cause instanceof Error ? cause.message : 'The session could not be updated.');
          return false;
        } finally {
          pending.current -= 1;
          if (!pending.current) setBusy(false);
        }
      };
      const result = queue.current.then(run);
      queue.current = result;
      return result;
    },
    [],
  );

  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    void request(() => connection.read(controller.signal), { drop: true });
    const poll = window.setInterval(() => {
      if (!isPlaying.current)
        void request(() => connection.read(controller.signal), { drop: true });
    }, 2500);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [connection, request]);

  const advance = useCallback(
    (timeS: number, options?: { drop?: boolean }) => {
      if (connection) void request(() => connection.advance(timeS), options);
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
        { drop: true },
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, advance, connection]);

  // Announce each server-flagged decision change once, however many polls return it.
  useEffect(() => {
    if (!snapshot) return;
    const result = trackDecisionChange(tracker.current, snapshot);
    tracker.current = result.state;
    const change = result.change;
    if (!change) return;
    setAnnounced(change);
    setHighlightKey(change.key);
    setDecisionLog((log) =>
      [change, ...log.filter((item) => item.key !== change.key)].slice(0, 20),
    );
  }, [snapshot]);
  useEffect(() => {
    if (!highlightKey) return;
    const timer = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  const roadView = snapshot ? roadViewFor(snapshot) : noRoadView;
  const recordedKey = roadView.kind === 'recorded' ? roadView.key : null;
  // The key demo moment: reveal the overlay whenever replay reaches a new recorded clip.
  useEffect(() => {
    if (recordedKey) setOverlayCollapsed(false);
  }, [recordedKey]);
  const onNeedsMoreRoom = useCallback((value: boolean) => {
    if (value) setOverlayCollapsed(true);
  }, []);

  const panelRef = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<'replay' | 'evidence' | 'settings' | 'routes'>('replay');
  const openPanel = (name: typeof panel) => {
    setPanel(name);
    panelRef.current?.showModal();
  };
  const selected = snapshot?.decision;
  const currentKey = selected ? decisionKey(selected) : null;
  const change = announced && announced.key === currentKey ? announced : null;
  const decisionMeta = [formatDetour(selected?.detourS), formatArrival(selected?.arrivalS)].filter(
    (item): item is string => item !== null,
  );
  const config = configDraft ?? snapshot?.config;
  const route = snapshot?.routes.find((item) => item.id === selected?.selectedRouteId);
  const unmapped = snapshot?.hazards.filter((hazard) => !isValidPoint(hazard.point)).length ?? 0;
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
                onNeedsMoreRoom={onNeedsMoreRoom}
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
            {/* Map chrome: every overlay is marked so the map fits geometry around it. */}
            <div className="ra-map-top">
              <div
                className={[
                  'ra-navigation-instruction',
                  highlightKey && highlightKey === currentKey && 'is-changed',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-map-chrome
              >
                <span className="ra-direction-icon">
                  {change ? <RefreshCw size={21} /> : <Navigation size={23} />}
                </span>
                <div>
                  {(change || selected?.syntheticBasis) && (
                    <span className="ra-card-badges">
                      {change && (
                        <span className="ra-change-badge">
                          <RefreshCw size={10} aria-hidden="true" />
                          {change.title}
                        </span>
                      )}
                      {selected?.syntheticBasis && (
                        <span className="ra-synthetic-chip">
                          <FlaskConical size={10} aria-hidden="true" />
                          SYNTHETIC EVENT
                        </span>
                      )}
                    </span>
                  )}
                  <strong>
                    {selected ? actionLabels[selected.action] : 'Your shared road ahead'}
                  </strong>
                  <span className="ra-decision-reason">
                    {selected?.reason ?? 'Waiting for a route recommendation'}
                  </span>
                  {decisionMeta.length > 0 && (
                    <span className="ra-decision-meta">{decisionMeta.join(' · ')}</span>
                  )}
                  <span className="ra-decision-event" aria-live="polite">
                    {change?.summary ?? ''}
                  </span>
                </div>
              </div>
              <VideoWidget
                roadView={roadView}
                collapsed={overlayCollapsed}
                onToggleCollapsed={() => setOverlayCollapsed((value) => !value)}
                onInference={setCameraInference}
              />
            </div>
            <div className="ra-map-footer-left" data-map-chrome>
              {error && snapshot && (
                <span className="ra-phone-update-error" role="alert">
                  Connection lost · last snapshot shown
                </span>
              )}
              <span className="ra-phone-provenance">
                {connection ? 'Session replay' : 'Synthetic fixture'} ·{' '}
                {snapshot ? timeLabel(snapshot.timeS) : 'connecting'}
              </span>
              <MapLegend unmapped={unmapped} />
              <span className="ra-map-disclaimer">Route overview · no street basemap</span>
            </div>
            <div className="ra-map-footer-right" data-map-chrome>
              <span className="ra-compass" role="img" aria-label="North is up">
                ↑<small>N</small>
              </span>
              <button
                className="ra-map-layer"
                aria-label="Show route alternatives"
                onClick={() => openPanel('routes')}
              >
                <Route size={18} />
              </button>
            </div>
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
                  onChange={(event) => {
                    setPlaying(false);
                    setDraftTime(Number(event.target.value));
                  }}
                />
                {draftTime !== null && (
                  <Button
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
                    : 'Offline playback steps through the generated canonical snapshots.'}
                </p>
                {!connection && (
                  <div className="ra-chapters">
                    {previewChapters().map((chapter) => (
                      <button
                        key={chapter.timeS}
                        data-chapter={chapter.timeS}
                        onClick={() => {
                          setPlaying(false);
                          setDraftTime(null);
                          advance(chapter.timeS);
                          panelRef.current?.close();
                        }}
                      >
                        {chapter.label}
                      </button>
                    ))}
                  </div>
                )}
                <h3>Decision changes</h3>
                {decisionLog.length ? (
                  <ol className="ra-decision-log" aria-label="Decision change events">
                    {decisionLog.map((item) => (
                      <li key={item.key}>{item.line}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="ra-subtle">No server-flagged route or recommendation change yet.</p>
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
                  Estimated obstruction delay: {formatDelay(selected?.delayS) ?? 'unknown'} ·
                  Detour: {formatDetour(selected?.detourS) ?? 'not supplied'} · Report ahead:{' '}
                  {formatArrival(selected?.arrivalS) ?? 'not supplied'}
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
                          disabled={applying}
                          onChange={(event) => {
                            setConfigError(null);
                            setConfigDraft({ ...config, [name]: Number(event.target.value) });
                          }}
                        />
                      </label>
                    ))}
                    {configDraft && (
                      <>
                        <p className="ra-subtle">
                          {connection
                            ? 'Unsaved settings · Apply sends them to the server session'
                            : 'Preview draft only · requires server to apply'}
                        </p>
                        <Button
                          disabled={applying || !connection}
                          onClick={() => {
                            if (!connection) return;
                            const draft = configDraft;
                            setApplying(true);
                            setConfigError(null);
                            void request(() => connection.configure(draft)).then((ok) => {
                              setApplying(false);
                              if (ok) setConfigDraft(null);
                              else
                                setConfigError(
                                  'Settings were not applied. The server rejected or did not answer the update; your draft is kept.',
                                );
                            });
                          }}
                        >
                          {applying ? 'Applying…' : 'Apply settings'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={applying}
                          onClick={() => {
                            setConfigDraft(null);
                            setConfigError(null);
                          }}
                        >
                          Discard
                        </Button>
                        {configError && (
                          <p className="ra-error" role="alert">
                            {configError}
                          </p>
                        )}
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
