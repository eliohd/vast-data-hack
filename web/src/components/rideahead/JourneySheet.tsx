import { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, MapPin, Route, Search, Square } from 'lucide-react';
import { distanceLabel, journeyFor } from '@/lib/rideahead/journey';
import type { SnapshotView } from '@/lib/rideahead/view';

export default function JourneySheet({
  snapshot,
  active,
  onEnd,
  onStart,
  onRoutes,
  onEvidence,
  offline,
}: {
  snapshot: SnapshotView | null;
  active: boolean;
  onEnd: () => void;
  onStart: () => void;
  onRoutes: () => void;
  onEvidence: () => void;
  offline: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const journey = journeyFor(snapshot, Date.now());
  const route = snapshot?.routes.find((item) => item.id === snapshot.decision?.selectedRouteId);
  const origin = route?.points.find(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  );
  const matches =
    !query ||
    [route?.name, ...(route?.steps?.map((step) => step.street_name ?? '') ?? [])].some((name) =>
      name?.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <section
      className={`ra-journey-sheet ra-glass ${expanded ? 'is-expanded' : ''}`}
      aria-label="Journey details"
      data-map-chrome
    >
      <button
        className="ra-sheet-handle"
        aria-label={expanded ? 'Collapse journey details' : 'Expand journey details'}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span />
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {active ? (
        <>
          <div className="ra-journey-stats">
            <div>
              <strong>
                {journey.minutes}
                <small> min</small>
              </strong>
              <span>remaining</span>
            </div>
            <div>
              <strong>{journey.distance}</strong>
              <span>distance left</span>
            </div>
            <div>
              <strong>{journey.arrival}</strong>
              <span>est. arrival</span>
            </div>
          </div>
          <div className="ra-trip-caption">
            <span className="ra-dot" />
            {snapshot?.riders.some((rider) => rider.simulated) ? 'Simulated ride' : 'Ride'} ·{' '}
            {route?.name ?? 'Route unavailable'}
            <button onClick={onRoutes} aria-label="Show route alternatives">
              <Route size={15} />
            </button>
          </div>
          <div className="ra-journey-actions">
            <button onClick={onEvidence}>
              Road reports <ArrowUpRight size={14} />
            </button>
            <button className="ra-end-route" onClick={onEnd}>
              <Square size={12} fill="currentColor" />
              End route
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Your next ride</h2>
          <label className="ra-origin">
            <MapPin size={15} />
            <span>From</span>
            <select aria-label="Departure point">
              <option>
                {origin
                  ? `Saved start · ${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`
                  : 'Start location unavailable'}
              </option>
            </select>
          </label>
          <label className="ra-destination-search">
            <Search size={18} />
            <input
              aria-label="Search available destinations"
              placeholder="Where to?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {route && matches ? (
            <button className="ra-saved-trip" onClick={onStart}>
              <span>
                <strong>{route.steps?.at(-1)?.street_name || 'Current planned journey'}</strong>
                <small>
                  {route.name} · {distanceLabel(route.distanceM)} · backend route
                </small>
              </span>
              <ArrowUpRight size={19} />
            </button>
          ) : (
            <p className="ra-subtle">
              No available journey matches. Custom destinations are not available yet.
            </p>
          )}
          <p className="ra-search-note">
            Search the current planned journey. A new departure or destination needs server routing
            support.
          </p>
        </>
      )}
      <div className="ra-journey-provenance">
        {offline
          ? 'Offline replay · cached routes + labelled scenario events'
          : 'Session replay · live / cached sources shown in evidence'}
      </div>
      {expanded && (
        <div className="ra-journey-extra">
          <p>{snapshot?.locationLabel ?? 'Location information unavailable'}</p>
          <p>{route?.provenance ?? 'Route source unavailable'}</p>
          <p>
            Arrival uses the server’s remaining journey estimate. This replay does not use your GPS.
          </p>
          <button onClick={onEvidence}>View source evidence & uncertainty</button>
        </div>
      )}
    </section>
  );
}
