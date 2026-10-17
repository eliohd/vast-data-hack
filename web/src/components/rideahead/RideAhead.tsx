import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Play, Pause, RotateCcw, X, SlidersHorizontal, Navigation, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useIsPhone } from '@/hooks/useIsPhone';
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
import GuideBubble from './GuideBubble';
import JourneySheet from './JourneySheet';
import MapLegend from './MapLegend';
import VideoWidget, {
  FeedPlayer,
  RecordedClip,
  type CameraInference,
  type RideFeed,
} from './VideoWidget';
import { clipsFromEvidence, feedIndex, type FeedClip } from '@/lib/rideahead/feed';
import EvidencePanel from './EvidencePanel';
import '@/styles/rideahead.css';
import '@/styles/street-navigation.css';

const noRoadView: RoadView = {
  kind: 'unavailable',
  key: null,
  label: 'No recorded clip for this moment',
  detail: 'Waiting for the session.',
};
const HIGHLIGHT_MS = 1600;
const SHOW_INFERENCE_KEY = 'cysense.phone.showInference';

function readShowInference(): boolean {
  try {
    return localStorage.getItem(SHOW_INFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function RideAhead({
  connection,
  sessionControls,
  rideFeed,
  onLive,
}: {
  /** Switch the phone app to live mode (GPS, destination, camera hazards). */
  onLive?: () => void;
  connection?: RideAheadConnection;
  sessionControls?: ReactNode;
  /** Recorded segments of the connected ride and the ride offset at session t=0. */
  rideFeed?: { clips: FeedClip[]; startOffsetS: number };
}) {
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
  const feed: RideFeed = (() => {
    if (rideFeed?.clips.length)
      return {
        clips: rideFeed.clips,
        index: feedIndex(rideFeed.clips, rideFeed.startOffsetS + (snapshot?.timeS ?? 0)),
      };
    const revealed = clipsFromEvidence(snapshot?.evidence ?? []);
    return { clips: revealed, index: Math.max(0, revealed.length - 1) };
  })();
  const panelRef = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<'evidence' | 'settings' | 'routes'>('evidence');
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
  const [navigationActive, setNavigationActive] = useState(true);
  const [cameraTools, setCameraTools] = useState<HTMLDivElement | null>(null);
  // Phone layout hides both desktop asides, so their controls move into the settings sheet.
  const isPhone = useIsPhone();
  const [phoneCameraTools, setPhoneCameraTools] = useState<HTMLDivElement | null>(null);
  const [showInference, setShowInference] = useState(readShowInference);
  const toggleInference = (value: boolean) => {
    setShowInference(value);
    try {
      localStorage.setItem(SHOW_INFERENCE_KEY, value ? '1' : '0');
    } catch {
      // per-device convenience only
    }
  };
  const unmapped = snapshot?.hazards.filter((hazard) => !isValidPoint(hazard.point)).length ?? 0;
  const cosmos = snapshot?.cosmos;
  const cosmosLabel = {
    live_model: 'Live model result',
    cached_model: 'Cached result',
    fixture: 'Fixture · no live inference',
    unavailable: 'Waiting for inference',
  };
  const inferenceTitle =
    cameraInference && cameraInference.model !== 'cosmos' ? 'Camera model' : 'Cosmos';
  const inferenceLabel = cameraInference?.label ?? cosmosLabel[cosmos?.source ?? 'unavailable'];
  const inferenceText =
    cameraInference?.text ?? cosmos?.text ?? 'Waiting for a model-checked observation.';

  return (
    <main className="ra-command-layout">
      <aside className="ra-command-centre" aria-label="Desktop analysis command centre">
        <div className="ra-desktop-brand">
          Cysense<span>.</span>
        </div>
        <p className="ra-eyebrow">ANALYSIS COMMAND CENTRE</p>
        <h1>
          One bike sees it.
          <br />
          <span>The next bike knows.</span>
        </h1>
        <p className="ra-command-intro">A shared view of the road, grounded in evidence.</p>
        {!isPhone && (
          <section className="ra-control-card ra-desktop-feed" aria-label="Ride camera">
            <div className="ra-control-title">
              <h2>Ride camera</h2>
              <span className="ra-tag">
                {roadView.kind === 'recorded' ? 'Event clip' : 'Recorded ride feed'}
              </span>
            </div>
            {roadView.kind === 'recorded' ? (
              <RecordedClip key={roadView.key} view={roadView} />
            ) : feed.clips.length ? (
              <FeedPlayer feed={feed} />
            ) : (
              <p className="ra-subtle">Footage appears when the replay reveals a recorded clip.</p>
            )}
          </section>
        )}
        {!isPhone && <section className="ra-control-card">{sessionControls}</section>}
        {snapshot && (
          <section className="ra-control-card">
            <div className="ra-control-title">
              <h2>Session replay</h2>
              <span className="ra-tag">{connection ? 'Server session' : 'Offline fixture'}</span>
            </div>
            <button
              className="ra-primary-action"
              disabled={!playing && (busy || snapshot.timeS >= snapshot.endS)}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? 'Pause replay' : 'Play replay'}
            </button>
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
          </section>
        )}
        <section className="ra-control-card">
          <h2>Live camera tools</h2>
          <div ref={setCameraTools} />
          <a className="ra-text-link" href="/live">
            Open live diagnostics ↗
          </a>
        </section>
        <p className="ra-command-footnote">
          Route selection and hazard lifecycle are determined by the server. Map movement is yours.
        </p>
      </aside>
      <div className="ra-phone-device">
        <div className="ra-phone-screen">
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
            <header className="ra-phone-header" data-map-chrome>
              <div className="ra-phone-wordmark">
                Cysense<span>.</span>
              </div>
              {isPhone && onLive && (
                <button
                  className="ra-glass ra-live-pill"
                  aria-label="Start live ride"
                  onClick={onLive}
                >
                  ● Live
                </button>
              )}
              <button
                className="ra-glass"
                aria-label="Open ride settings"
                onClick={() => openPanel('settings')}
              >
                <SlidersHorizontal size={18} />
              </button>
            </header>
            <div className="ra-map-top">
              <GuideBubble
                snapshot={snapshot}
                active={navigationActive}
                updating={busy && playing}
                change={change}
                highlight={!!highlightKey && highlightKey === currentKey}
                inference={cameraInference}
                onEvidence={() => openPanel('evidence')}
              />
              <VideoWidget
                roadView={roadView}
                collapsed={overlayCollapsed}
                onToggleCollapsed={() => setOverlayCollapsed((value) => !value)}
                onInference={setCameraInference}
                toolsTarget={isPhone ? phoneCameraTools : cameraTools}
                feed={feed}
              />
            </div>
            {isPhone && showInference && (
              <button
                className="ra-phone-inference ra-glass"
                data-map-chrome
                onClick={() => openPanel('evidence')}
                aria-live="polite"
              >
                <span className="ra-phone-inference-title">
                  <Sparkles size={13} />
                  {inferenceTitle}
                  <span className="ra-tag">{inferenceLabel}</span>
                </span>
                <span className="ra-phone-inference-text">{inferenceText}</span>
              </button>
            )}
            {error && snapshot && (
              <div className="ra-connection-toast" role="alert">
                Connection lost · last snapshot shown
              </div>
            )}
            <JourneySheet
              snapshot={snapshot}
              active={navigationActive}
              onEnd={() => {
                setNavigationActive(false);
                setPlaying(false);
              }}
              onStart={() => setNavigationActive(true)}
              onRoutes={() => openPanel('routes')}
              onEvidence={() => openPanel('evidence')}
              offline={!connection}
            />
          </section>
        </div>
      </div>
      <aside className="ra-analysis-inspector" aria-label="Desktop evidence inspector">
        <div className="ra-inspector-heading">
          <span className="ra-eyebrow">THE ROAD, EXPLAINED</span>
          <h2>Evidence & insight</h2>
          <span className="ra-tag">
            {snapshot ? timeLabel(snapshot.timeS) : 'Connecting'} · replay time
          </span>
        </div>
        <section className="ra-control-card ra-inference-card">
          <h3>
            <Sparkles size={16} />
            {inferenceTitle}
          </h3>
          <span className="ra-tag">{inferenceLabel}</span>
          <p>{inferenceText}</p>
        </section>
        {snapshot && (
          <>
            <section className="ra-control-card">
              <h3>{selected ? actionLabels[selected.action] : 'Decision pending'}</h3>
              <p>{selected?.reason}</p>
              <p className="ra-subtle">{decisionMeta.join(' · ')}</p>
              <MapLegend unmapped={unmapped} />
              <p className="ra-subtle">{snapshot.locationLabel}</p>
            </section>
            <EvidencePanel snapshot={snapshot} selectedHazard={selectedHazard} />
          </>
        )}
      </aside>
      <dialog ref={panelRef} className="ra-phone-sheet">
        <div className="ra-sheet-header">
          <h2>
            {
              {
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
        {isPhone && panel === 'settings' && (
          <section className="ra-panel ra-phone-demo">
            {sessionControls}
            {snapshot && (
              <div className="ra-phone-demo-row">
                <Button
                  disabled={!playing && (busy || snapshot.timeS >= snapshot.endS)}
                  onClick={() => {
                    setPlaying(!playing);
                    if (!playing) panelRef.current?.close();
                  }}
                >
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                  {playing ? 'Pause replay' : 'Play replay'}
                </Button>
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
                <span className="ra-subtle">
                  {timeLabel(snapshot.timeS)} / {timeLabel(snapshot.endS)}
                </span>
              </div>
            )}
            <label className="ra-phone-demo-toggle">
              <span>
                <strong>Show live Cosmos inference</strong>
                <span className="ra-subtle">Model output on the map while you ride</span>
              </span>
              <Switch checked={showInference} onCheckedChange={toggleInference} />
            </label>
            <h3>Camera</h3>
            <div ref={setPhoneCameraTools} />
          </section>
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
            A server session is not available. Use the shared demo link, or{' '}
            <a className="ra-text-link" href="?preview=1">
              open the offline replay
            </a>
            .
          </p>
        ) : (
          <>
            <p className="ra-subtle">{snapshot.provenance}</p>
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
