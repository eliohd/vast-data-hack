import { useCallback, useEffect, useRef, useState } from 'react';
import { Bike, Play, Pause, RotateCcw, ArrowUpRight, Radio, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewAt, previewFrames } from '@/lib/rideahead/preview';
import { timeLabel, type RideAheadConnection, type SnapshotView } from '@/lib/rideahead/view';
import RouteMap from './RouteMap';
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

  const selected = snapshot?.decision;
  const config = configDraft ?? snapshot?.config;
  return (
    <div className="ra-shell">
      <header className="ra-header">
        <a className="ra-brand" href="/" aria-label="RideAhead home">
          <span>
            <Bike size={23} />
          </span>
          RideAhead<span className="ra-brand-dot">.</span>
        </a>
        <div className="ra-header-right">
          <span className="ra-tag">
            <Radio size={12} /> Server-mediated sharing
          </span>
          <a href="/live">
            Live camera <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main className="ra-main">
        <div className="ra-intro">
          <div>
            <span className="ra-eyebrow">A LITTLE FORESIGHT. A BETTER RIDE.</span>
            <h1>
              One bike sees it.
              <br />
              <span>The next bike avoids it.</span>
            </h1>
            <p>Shared road reports, with the evidence to understand what’s ahead.</p>
          </div>
          <div className="ra-session-label">
            <span className="ra-dot" />
            {connection
              ? snapshot
                ? 'Server replay session'
                : 'Connecting to server…'
              : 'Offline canonical fixture'}
            <small>
              {snapshot
                ? `Session ${snapshot.id} · revision ${snapshot.revision}`
                : 'Loading session…'}
            </small>
          </div>
        </div>
        {!connection && (
          <div className="ra-banner" role="status">
            <strong>Offline canonical fixture</strong>
            <span>
              All coordinates, routes, riders and events are synthetic. Recorded footage, model
              checks and real routing are not connected. Play steps through authored snapshots.
            </span>
          </div>
        )}
        {snapshot && (
          <p className="ra-subtle" role="note">
            {snapshot.provenance}
          </p>
        )}
        {error && (
          <div className="ra-error" role="alert">
            <strong>Session update failed.</strong>
            <p>{error}</p>
            <p>The last snapshot may be out of date.</p>
            {connection && (
              <Button
                variant="outline"
                onClick={() => void request(() => connection.read())}
                disabled={busy}
              >
                Retry connection
              </Button>
            )}
          </div>
        )}
        {!snapshot ? (
          <div className="ra-panel" role="status">
            {error
              ? 'Session unavailable. Retry the connection above.'
              : 'Loading riders, reports and route…'}
          </div>
        ) : (
          <>
            <section className="ra-replay" aria-label="Replay controls">
              <div className="ra-replay-top">
                <div>
                  <span className="ra-eyebrow">RIDE REPLAY</span>
                  <p>
                    {timeLabel(snapshot.timeS)} <span>/ {timeLabel(snapshot.endS)}</span>
                  </p>
                </div>
                <div className="ra-replay-buttons">
                  <Button
                    variant="outline"
                    aria-label="Reset replay"
                    disabled={busy}
                    onClick={() => {
                      setPlaying(false);
                      setDraftTime(null);
                      advance(0);
                    }}
                  >
                    <RotateCcw size={16} />
                  </Button>
                  <Button
                    disabled={busy || snapshot.timeS >= snapshot.endS}
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                    {playing ? 'Pause' : 'Play'}
                  </Button>
                </div>
              </div>
              <label className="ra-sr-only" htmlFor="ra-time">
                Replay time in seconds
              </label>
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
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    advance(draftTime);
                    setDraftTime(null);
                  }}
                >
                  Go to {timeLabel(draftTime)}
                </Button>
              )}
              <div className="ra-replay-caption">
                <span>Only evidence available at this replay time is shown.</span>
                <span>{busy ? 'Updating…' : playing ? 'Playing' : 'Paused'}</span>
              </div>
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
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <div className="ra-workspace">
              <div className="ra-left">
                <RouteMap
                  snapshot={snapshot}
                  selectedHazard={selectedHazard ?? snapshot.hazards[0]?.id ?? null}
                  onSelect={setSelectedHazard}
                />
                <section className="ra-panel">
                  <div className="ra-panel-title">
                    <h2>Your route options</h2>
                    <Route size={18} />
                  </div>
                  <div className="ra-routes">
                    {snapshot.routes.map((route) => (
                      <article
                        key={route.id}
                        className={selected?.selectedRouteId === route.id ? 'is-selected' : ''}
                      >
                        <div>
                          <h3>{route.name}</h3>
                          {selected?.selectedRouteId === route.id && (
                            <span className="ra-tag">
                              Recommended by {connection ? 'server' : 'fixture'}
                            </span>
                          )}
                        </div>
                        <p>
                          {route.durationS === null
                            ? 'Duration unknown'
                            : `${Math.ceil(route.durationS / 60)} min`}{' '}
                          ·{' '}
                          {route.distanceM === null
                            ? 'Distance unknown'
                            : `${(route.distanceM / 1000).toFixed(2)} km`}
                        </p>
                        <small>{route.provenance}</small>
                        {route.warnings.map((warning) => (
                          <p className="ra-route-warning" key={warning}>
                            {warning}
                          </p>
                        ))}
                      </article>
                    ))}
                  </div>
                  {snapshot.routes.length === 0 && <p>No valid routes are available.</p>}
                </section>
              </div>
              <aside className="ra-right">
                <section className="ra-decision" aria-labelledby="ra-decision-heading">
                  <div className="ra-panel-title">
                    <span className="ra-eyebrow">
                      FOR{' '}
                      {snapshot.riders.find((rider) => rider.id === selected?.riderId)?.name ??
                        'Bike B'}
                    </span>
                    <Bike size={22} />
                  </div>
                  <h2 id="ra-decision-heading">
                    {selected ? actionLabels[selected.action] : 'Waiting for a report'}
                  </h2>
                  <p>
                    {selected?.reason ??
                      'No rider-specific recommendation is available at this replay time.'}
                  </p>
                  {selected && (
                    <>
                      <div className="ra-decision-metrics">
                        <div>
                          <span>Estimated delay</span>
                          <strong>
                            {selected.delayS === null ? 'Unknown' : `${selected.delayS}s`}
                          </strong>
                        </div>
                        <div>
                          <span>Detour cost</span>
                          <strong>
                            {selected.detourS === null ? 'Unknown' : `+${selected.detourS}s`}
                          </strong>
                        </div>
                      </div>
                      <p className="ra-decision-source">
                        {connection ? 'Server decision' : 'Fixture snapshot decision'} ·{' '}
                        {selected.changed ? 'Recommendation changed' : 'Recommendation unchanged'}
                      </p>
                      <details>
                        <summary>Evidence & assumptions</summary>
                        <p>Evidence: {selected.evidenceIds.join(', ') || 'None supplied'}</p>
                        {selected.assumptions.map((item) => (
                          <p key={item}>{item}</p>
                        ))}
                      </details>
                    </>
                  )}
                </section>
                <section className="ra-panel">
                  <h2>Sharing & planning</h2>
                  <p className="ra-subtle">
                    Applied settings come from the session. Route and direction matching are
                    evaluated by the server.
                  </p>
                  {config && (
                    <>
                      {(['shortRadiusM', 'planningRadiusM'] as const).map((name) => (
                        <label className="ra-slider-label" key={name}>
                          {name === 'shortRadiusM' ? 'Nearby reports' : 'Planning area'}
                          <strong>{config[name]} m</strong>
                          <input
                            type="range"
                            min={name === 'shortRadiusM' ? 50 : 500}
                            max={name === 'shortRadiusM' ? 1000 : 5000}
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
                        <div>
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
                        </div>
                      )}
                    </>
                  )}
                  <div className="ra-riders">
                    {snapshot.riders.map((rider) => (
                      <p key={rider.id}>
                        <strong>{rider.name}</strong>
                        <span>
                          {rider.simulated ? 'Simulated' : 'Recorded observer'}
                          {rider.point ? '' : ' · position unknown'}
                        </span>
                      </p>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
            <EvidencePanel snapshot={snapshot} selectedHazard={selectedHazard} />
            <details className="ra-panel ra-integrations">
              <summary>
                Integrations & provenance{' '}
                <span>
                  {snapshot.integrations.filter((item) => item.status === 'Connected').length}/
                  {snapshot.integrations.length} connected
                </span>
              </summary>
              <p>{snapshot.provenance}</p>
              <div className="ra-integration-grid">
                {snapshot.integrations.map((item) => (
                  <article key={item.name}>
                    <strong>{item.name}</strong>
                    <span className="ra-tag">{item.status}</span>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
            </details>
          </>
        )}
        <footer className="ra-footer">
          <span>RideAhead · shared observations, clearer decisions.</span>
          <span>
            {connection ? 'Replay navigation prototype' : 'Synthetic preview · not for navigation'}
          </span>
        </footer>
      </main>
    </div>
  );
}
